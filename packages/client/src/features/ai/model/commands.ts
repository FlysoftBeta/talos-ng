import { AppError, concat, utf8Decode } from "@talos/base";
import { ai, contract } from "@talos/contract";
import type { Method, ArgsOf, ResultOf } from "@talos/contract";
import type {
  RuntimeCommandPort,
  RuntimeFilePort,
  RuntimeQueryPort,
} from "../../../core/runtime-port.ts";

/** Contract calls that need only command dispatch. */
export type AiCallPort = Pick<RuntimeCommandPort, "command" | "operation">;
/** Message paging additionally admits fetched rows into the synchronized mirror. */
export type AiPagePort = AiCallPort & Pick<RuntimeQueryPort, "loadRows">;
/** Draft and long-text staging writes durable commands and an account-local string cache. */
export type AiTextPort = AiCallPort & Pick<RuntimeFilePort, "setLocal">;
/** Full-text retrieval reads the local cache and the ranged content method. */
export type AiContentPort = Pick<RuntimeCommandPort, "can" | "fetchBody"> &
  Pick<RuntimeFilePort, "getLocal" | "setLocal">;

/** An image picked by the user; the browser adapter turns the handle into bytes. */
export interface AiPickedFile {
  readonly type: string;
  readonly size: number;
}
/** Browser capabilities for picked images; object URLs are released through `revoke`. */
export interface AiImageFiles<F extends AiPickedFile = AiPickedFile> {
  read(file: F): Promise<Uint8Array>;
  preview(file: F): string;
  revoke(url: string): void;
}
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const IMAGE_LIMIT = 5 * 1024 * 1024;
const UPLOAD_CHUNK = 512 * 1024;
export const TEXT_CHUNK = 16000;
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试";
}
export async function call<M extends Method>(
  r: AiCallPort,
  m: M,
  a: ArgsOf<M>,
): Promise<ResultOf<M>> {
  const result = await r.command(m, a, { op: r.operation().op });
  if (result && typeof result === "object" && "queued" in result)
    throw new AppError("E_INTERNAL", "在线操作不能排队");
  return result as ResultOf<M>;
}
export async function saveDraft(
  r: AiTextPort,
  id: string,
  text: string,
): Promise<void> {
  const source = await textSource(r, text);
  const { op, t } = r.operation();
  await r.command(
    ai.draft.set,
    {
      id,
      value: { v: text.slice(0, TEXT_CHUNK), t, op },
      ...(source.textId ? { textId: source.textId } : {}),
    },
    { op },
  );
}
export async function page(
  r: AiPagePort,
  id: string,
  before?: number,
): Promise<boolean> {
  const result = await call(r, ai.message.page, {
    conversation: id,
    limit: 10,
    ...(before ? { before } : {}),
  });
  await r.loadRows(
    `ai:${id}`,
    result.messages.map((m) => ({
      type: "aiMessage",
      id: m.id,
      rev: m.rev,
      deleted: false,
      data: m,
    })),
  );
  return result.more;
}
export async function uploadImage<F extends AiPickedFile>(
  r: AiCallPort,
  files: AiImageFiles<F>,
  file: F,
): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type) || file.size > IMAGE_LIMIT || !file.size)
    throw new AppError(
      "E_INVALID",
      "仅支持 PNG、JPEG、WebP、GIF，单张不超过 5 MiB",
    );
  const bytes = await files.read(file);
  const id = r.operation().op;
  await call(r, contract.upload.begin, {
    id,
    kind: "image",
    size: bytes.length,
  });
  for (let offset = 0; offset < bytes.length; offset += UPLOAD_CHUNK)
    await r.command(
      contract.upload.append,
      { id, offset },
      { body: bytes.subarray(offset, offset + UPLOAD_CHUNK) },
    );
  await call(r, contract.upload.commit, { id });
  return (
    await call(r, ai.workspace.image, {
      upload: id,
      mime: file.type as "image/png",
    })
  ).path;
}

export async function textSource(
  r: AiTextPort,
  text: string,
): Promise<{ text: string; textId?: string }> {
  if (text.length <= TEXT_CHUNK) return { text };
  const id = r.operation().op;
  await r.setLocal(`ai:text:${id}`, text);
  for (let offset = 0; offset < text.length; offset += TEXT_CHUNK)
    await r.command(ai.text.put, {
      id,
      offset,
      total: text.length,
      text: text.slice(offset, offset + TEXT_CHUNK),
    });
  return { text: text.slice(0, TEXT_CHUNK), textId: id };
}
export async function content(
  r: Pick<RuntimeCommandPort, "fetchBody">,
  kind: "message" | "draft" | "file",
  id: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (;;) {
    const reply = await r.fetchBody(ai.content.fetch, { kind, id, offset });
    chunks.push(reply.body);
    offset += reply.body.length;
    if (reply.data.eof) return concat(...chunks);
  }
}
export async function fullText(
  r: AiContentPort,
  id: string,
  rev: number,
  kind: "message" | "draft" = "message",
): Promise<string | undefined> {
  if (kind === "draft") {
    const local = await r.getLocal<string>(`ai:text:${id}`);
    if (local !== undefined) return local;
  }
  const key = `ai:${kind === "draft" ? "draft-full" : "full"}:${id}:${rev}`,
    old = await r.getLocal<string>(key);
  if (old !== undefined) return old;
  if (!r.can(ai.content.fetch).ok) return undefined;
  const text = utf8Decode(await content(r, kind, id));
  await r.setLocal(key, text);
  return text;
}
