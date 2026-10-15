import { AppError, utf8Decode, utf8Encode } from "@talos/base";
import type { AiFile } from "@talos/contract";
import { z } from "@talos/contract";
import type { Uow } from "../../../kernel/persistence/uow.ts";
import type { AiRepo, FileRecord } from "../repo.ts";
export const WORKSPACE_BYTES = 10 * 1024 * 1024,
  WORKSPACE_FILES = 256;
export function safePath(value: string, image = false): string {
  const parts = value.split("/");
  if (
    value !== value.normalize("NFC") ||
    value.length > 240 ||
    parts.length > 3 ||
    parts.some(
      (p) =>
        !p ||
        p.startsWith(".") ||
        p.endsWith(".") ||
        p.endsWith(" ") ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p),
    ) ||
    /[\\\x00-\x1f\x7f:%<>"|?*]/.test(value) ||
    !(
      /\.(txt|md|svg)$/i.test(value) ||
      (image && /\.(png|jpg|gif|webp)$/i.test(value))
    ) ||
    (!image && parts[0]?.toLowerCase() === "attachments")
  )
    throw new AppError(
      "E_INVALID",
      "路径无效：仅允许两级目录及 TXT、MD、SVG 文件",
    );
  return value;
}
/** Deliberately narrow SVG grammar; no CSS, references, entities or active elements. */
export function safeText(path: string, text: string): void {
  if (text.includes("\0")) throw new AppError("E_INVALID", "文件包含无效字符");
  if (!path.toLowerCase().endsWith(".svg")) return;
  const allowed = new Set([
    "svg",
    "g",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "title",
    "desc",
  ]);
  const attrs = new Set([
    "xmlns",
    "viewBox",
    "width",
    "height",
    "x",
    "y",
    "x1",
    "x2",
    "y1",
    "y2",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "d",
    "points",
    "fill",
    "stroke",
    "stroke-width",
    "opacity",
    "transform",
    "font-size",
    "text-anchor",
  ]);
  if (
    /<!|<\?|&|url\s*\(|[\u0000-\u0008]/i.test(text) ||
    !/^\s*<svg[\s>]/.test(text) ||
    !/<\/svg>\s*$/.test(text)
  )
    throw new AppError("E_INVALID", "SVG 必须是安全的静态图形");
  let rest = text;
  for (const m of text.matchAll(/<\s*(\/?)([\w:-]+)([^>]*)>/g)) {
    if (!allowed.has(m[2]!))
      throw new AppError("E_INVALID", "SVG 元素不受支持");
    let tail = m[3]!.replace(/\/$/, "");
    for (const a of tail.matchAll(/([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/g)) {
      if (
        !attrs.has(a[1]!) ||
        (/(?:javascript|data|https?):/i.test(a[2]!) && a[1] !== "xmlns")
      )
        throw new AppError("E_INVALID", "SVG 属性不受支持");
      tail = tail.replace(a[0], "");
    }
    if (tail.trim()) throw new AppError("E_INVALID", "SVG 属性格式无效");
    rest = rest.replace(m[0], "");
  }
  if (/[<>]/.test(rest)) throw new AppError("E_INVALID", "SVG 格式无效");
}
export function imageValid(mime: string, bytes: Uint8Array): boolean {
  const b = Buffer.from(bytes);
  return mime === "image/png"
    ? b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    : mime === "image/jpeg"
      ? b[0] === 255 && b[1] === 216 && b[2] === 255
      : mime === "image/gif"
        ? /^GIF8[79]a/.test(b.subarray(0, 6).toString())
        : mime === "image/webp" &&
          b.subarray(0, 4).toString() === "RIFF" &&
          b.subarray(8, 12).toString() === "WEBP";
}
export function fileMeta(f: FileRecord): AiFile {
  return { path: f.path, mime: f.mime, size: f.bytes.length, rev: f.rev };
}
export class Workspace {
  constructor(
    readonly repo: Pick<
      AiRepo,
      "files" | "file" | "putFile" | "deleteFile" | "tool" | "putTool"
    >,
    readonly uow: Uow,
  ) {}
  list(user: string): AiFile[] {
    return this.repo.files(user).map(fileMeta);
  }
  read(user: string, path: string): { file: AiFile; content: string } {
    safePath(path, true);
    const f = this.repo.file(user, path);
    if (!f) throw new AppError("E_NOT_FOUND", "文件不存在");
    return {
      file: fileMeta(f),
      content:
        f.mime.startsWith("image/") && f.mime !== "image/svg+xml"
          ? `data:${f.mime};base64,${Buffer.from(f.bytes).toString("base64")}`
          : utf8Decode(f.bytes),
    };
  }
  write(
    user: string,
    path: string,
    content: string,
    expected: number | null,
  ): AiFile {
    safePath(path);
    safeText(path, content);
    return this.put(
      user,
      path,
      path.endsWith(".svg")
        ? "image/svg+xml"
        : path.endsWith(".md")
          ? "text/markdown"
          : "text/plain",
      utf8Encode(content),
      expected,
    );
  }
  put(
    user: string,
    path: string,
    mime: string,
    bytes: Uint8Array,
    expected: number | null,
  ): AiFile {
    return this.uow.write((ctx) => {
      const prior = this.repo.file(user, path);
      if ((prior?.rev ?? null) !== expected)
        throw new AppError("E_CONFLICT", "文件已修改或已存在，请重新打开");
      const files = this.repo.files(user);
      if (
        files.length + (prior ? 0 : 1) > WORKSPACE_FILES ||
        files.reduce((n, f) => n + f.bytes.length, 0) -
          (prior?.bytes.length ?? 0) +
          bytes.length >
          WORKSPACE_BYTES
      )
        throw new AppError("E_TOO_LARGE", "工作区上限为 10 MiB / 256 个文件");
      const f = { user, path, mime, bytes, rev: ctx.rev };
      this.repo.putFile(f);
      return fileMeta(f);
    });
  }
  delete(user: string, path: string, expected: number): { ok: true } {
    safePath(path);
    return this.uow.write(() => {
      if (this.repo.file(user, path)?.rev !== expected)
        throw new AppError("E_CONFLICT", "文件已修改，请重新打开");
      this.repo.deleteFile(user, path);
      return { ok: true };
    });
  }
  tool(
    user: string,
    run: string,
    call: { id: string; name: string; arguments: string },
  ): unknown {
    return this.uow.write(() => {
      const saved = this.repo.tool(run, call.id);
      if (saved !== undefined) return saved;
      let result: unknown;
      try {
        const args = z
          .record(z.unknown())
          .parse(JSON.parse(call.arguments) as unknown);
        const p = () => z.string().parse(args.path);
        if (call.name === "list_files") result = this.list(user);
        else if (call.name === "read_file")
          result = this.read(user, safePath(p()));
        else if (call.name === "create_file")
          result = this.write(user, p(), z.string().parse(args.content), null);
        else if (call.name === "delete_file") {
          const f = this.read(user, p());
          result = this.delete(user, p(), f.file.rev);
        } else if (call.name === "replace_text") {
          const f = this.read(user, p()),
            old = z.string().min(1).parse(args.oldText),
            next = z.string().parse(args.newText),
            count = z
              .number()
              .int()
              .min(1)
              .max(100)
              .parse(args.expectedReplacements);
          if (f.content.split(old).length - 1 !== count)
            throw new AppError("E_CONFLICT", "替换次数与预期不符");
          result = this.write(
            user,
            p(),
            f.content.split(old).join(next),
            f.file.rev,
          );
        } else throw new AppError("E_INVALID", "未知文件工具");
      } catch (e) {
        result = {
          error: e instanceof AppError ? e.message : "文件工具参数无效",
        };
      }
      this.repo.putTool(run, call.id, result);
      return result;
    });
  }
}
const properties = {
  path: { type: "string" },
  content: { type: "string" },
  oldText: { type: "string" },
  newText: { type: "string" },
  expectedReplacements: { type: "integer", minimum: 1, maximum: 100 },
};
export const fileTools: readonly Record<string, unknown>[] = Object.entries({
  list_files: [],
  read_file: ["path"],
  create_file: ["path", "content"],
  replace_text: ["path", "oldText", "newText", "expectedReplacements"],
  delete_file: ["path"],
}).map(([name, keys]) => ({
  type: "function",
  name,
  description: name,
  strict: true,
  parameters: {
    type: "object",
    properties: Object.fromEntries(
      keys.map((k) => [k, properties[k as keyof typeof properties]]),
    ),
    required: keys,
    additionalProperties: false,
  },
}));
