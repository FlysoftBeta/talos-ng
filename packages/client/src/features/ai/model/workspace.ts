import { utf8Decode } from "@talos/base";
import { ai } from "@talos/contract";
import type { AiFile } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type {
  RuntimeCommandPort,
  RuntimeFilePort,
  RuntimeQueryPort,
} from "../../../core/runtime-port.ts";
import { call, content, errorText, textSource } from "./commands.ts";

/** Runtime capabilities the AI workspace needs. */
export type AiWorkspacePort = Pick<
  RuntimeCommandPort,
  "can" | "command" | "fetchBody" | "operation" | "flush"
> &
  Pick<RuntimeFilePort, "getLocal" | "setLocal"> &
  Pick<RuntimeQueryPort, "subscribe">;

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** Standard padded base64; images open as data URLs so no object URL lifecycle is needed. */
export function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!,
      b = bytes[i + 1],
      c = bytes[i + 2],
      n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out +=
      BASE64[(n >> 18) & 63]! +
      BASE64[(n >> 12) & 63]! +
      (b === undefined ? "=" : BASE64[(n >> 6) & 63]!) +
      (c === undefined ? "=" : BASE64[n & 63]!);
  }
  return out;
}
/** Raster images are shown as data URLs; SVG and text are decoded as text. */
export function isRasterImage(mime: string): boolean {
  return mime.startsWith("image/") && mime !== "image/svg+xml";
}
export function fileText(file: AiFile, bytes: Uint8Array): string {
  return isRasterImage(file.mime)
    ? `data:${file.mime};base64,${base64(bytes)}`
    : utf8Decode(bytes);
}
export type PreviewKind = "raster" | "svg" | "rich";
export function previewKind(path: string, text: string): PreviewKind {
  return text.startsWith("data:image/")
    ? "raster"
    : path.endsWith(".svg")
      ? "svg"
      : "rich";
}
export function svgDataUrl(text: string): string {
  return `data:image/svg+xml,${encodeURIComponent(text)}`;
}
/** Attachment files are read-only and never deleted from the workspace UI. */
export function isAttachment(file: AiFile | undefined): boolean {
  return !!file && file.path.startsWith("attachments/");
}
export function fileSizeLabel(size: number): string {
  return `${Math.ceil(size / 1024)} KiB`;
}

export interface WorkspaceState {
  files: AiFile[];
  selected: AiFile | undefined;
  path: string;
  text: string;
  error: string;
  loading: boolean;
  confirm: boolean;
  preview: boolean;
  list: Capability;
  write: Capability;
}

/** Per-user AI workspace: online listing with an offline copy, cached file bodies, revision-checked saves. */
export class WorkspaceController extends StateStore<WorkspaceState> {
  private open = false;
  private seenList: boolean | undefined;
  private cleanup: (() => void) | undefined;
  constructor(private readonly port: AiWorkspacePort) {
    super({
      files: [],
      selected: undefined,
      path: "",
      text: "",
      error: "",
      loading: false,
      confirm: false,
      preview: false,
      list: { ok: true },
      write: { ok: true },
    });
    this.capabilities();
  }
  attach(): void {
    this.cleanup = this.port.subscribe(() => this.sync());
    this.sync();
  }
  detach(): void {
    this.cleanup?.();
    this.cleanup = undefined;
  }
  /** The sheet opened or closed; opening loads the listing. */
  setOpen = (open: boolean): void => {
    if (open === this.open) return;
    this.open = open;
    this.seenList = undefined;
    this.sync();
  };
  createFile = (): void =>
    this.patch({
      selected: undefined,
      path: "新文件.md",
      text: "",
      preview: false,
    });
  setPath = (path: string): void => this.patch({ path });
  setText = (text: string): void => this.patch({ text });
  togglePreview = (): void => this.patch({ preview: !this.state.preview });
  askDelete = (): void => this.patch({ confirm: true });
  cancelDelete = (): void => this.patch({ confirm: false });
  select = async (f: AiFile): Promise<void> => {
    this.patch({ error: "" });
    try {
      const key = `ai:file:${f.path}:${f.rev}`;
      let text = await this.port.getLocal<string>(key);
      if (this.port.can(ai.workspace.list).ok) {
        text = fileText(f, await content(this.port, "file", f.path));
        await this.port.setLocal(key, text);
      }
      if (text === undefined) {
        this.patch({ error: "离线未缓存" });
        return;
      }
      this.patch({ selected: f, path: f.path, text, preview: true });
    } catch (e) {
      this.patch({ error: errorText(e) });
    }
  };
  save = async (): Promise<void> => {
    try {
      const { path, text, selected } = this.state,
        source = await textSource(this.port, text);
      await this.port.flush();
      const f = await call(this.port, ai.workspace.write, {
        path,
        content: source.text,
        textId: source.textId,
        expected: selected?.rev ?? null,
      });
      this.patch({ selected: f, error: "" });
      await this.reload();
    } catch (e) {
      this.patch({ error: errorText(e) });
    }
  };
  remove = async (): Promise<void> => {
    const { selected, path } = this.state;
    if (!selected) return;
    try {
      await call(this.port, ai.workspace.delete, {
        path,
        expected: selected.rev,
      });
      this.patch({ confirm: false, path: "" });
      await this.reload();
    } catch (e) {
      this.patch({ error: errorText(e) });
    }
  };
  private capabilities(): void {
    this.patch({
      list: this.port.can(ai.workspace.list),
      write: this.port.can(ai.workspace.write),
    });
  }
  private sync(): void {
    this.capabilities();
    if (!this.open) return;
    const ok = this.state.list.ok;
    if (ok === this.seenList) return;
    this.seenList = ok;
    if (ok) void this.reload();
    else
      void this.port
        .getLocal<AiFile[]>("ai:workspace-list")
        .then((value) => this.patch({ files: value ?? [] }));
  }
  private async reload(): Promise<void> {
    this.patch({ loading: true });
    try {
      const next = await call(this.port, ai.workspace.list, {});
      this.patch({ files: next });
      await this.port.setLocal("ai:workspace-list", next);
    } catch (e) {
      this.patch({ error: errorText(e) });
    } finally {
      this.patch({ loading: false });
    }
  }
}
