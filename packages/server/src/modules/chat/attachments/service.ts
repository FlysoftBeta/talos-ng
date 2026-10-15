import { AppError, Semaphore, sha256Hex } from "@talos/base";
import type { ChatImage, ChatSticker } from "@talos/contract";
import { CHAT_IMAGE_LIMIT } from "@talos/contract";
import type { ObjectInfo } from "@talos/objectstore";
import { beginObjectBatch } from "@talos/objectstore";
import sharp from "sharp";
import type { Sharp } from "sharp";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BodyChunk, ChatOptions } from "../options.ts";
import type { ChatRepo } from "../repo.ts";
import { decodeBmp } from "./bmp.ts";
import { validateImageBounds } from "./image-bounds.ts";
interface SeedSticker {
  id: string;
  pack: string;
  name: string;
  path: string;
  mime: string;
  width: number;
  height: number;
}
/** Pure JS PNG/JPEG/GIF/BMP/TIFF decoder; no native addons or platform binaries. */
export class ChatAttachments {
  private seedTask: Promise<void> | undefined;
  private readonly images = new Semaphore(2);
  constructor(
    private readonly options: Pick<
      ChatOptions,
      "objects" | "store" | "uow" | "uploads"
    >,
    private readonly repo: Pick<
      ChatRepo,
      "sticker" | "putSticker" | "stickers"
    >,
  ) {}
  seed(): Promise<void> {
    if (!this.seedTask)
      this.seedTask = this.seedAll().catch((error) => {
        this.seedTask = undefined;
        throw error;
      });
    return this.seedTask;
  }
  private async seedAll(): Promise<void> {
    let root = fileURLToPath(new URL("../../../../stickers/", import.meta.url));
    try {
      await access(join(root, "catalog.json"));
    } catch {
      root = fileURLToPath(new URL("./stickers/", import.meta.url));
    }
    const catalog = JSON.parse(
      await readFile(join(root, "catalog.json"), "utf8"),
    ) as SeedSticker[];
    await this.options.objects.snapshot(async () => {
      const batch = beginObjectBatch(this.options.store);
      const pending: { sticker: SeedSticker; info: ObjectInfo }[] = [];
      for (const sticker of catalog) {
        const existing = this.repo.sticker(sticker.id);
        if (existing && (await this.options.store.verify(existing.file.rid)))
          continue;
        const bytes = await readFile(join(root, sticker.path));
        pending.push({ sticker, info: await batch.put(bytes) });
      }
      await batch.commit();
      if (!pending.length) return;
      // No catalog or ledger rows can survive ahead of durable object bytes.
      this.options.uow.write(() => {
        for (const { sticker, info } of pending) {
          this.options.objects.register(info);
          this.options.objects.addRef(info.id, "chat-sticker", sticker.id);
          this.repo.putSticker({
            id: sticker.id,
            pack: sticker.pack,
            name: sticker.name,
            file: {
              rid: info.id,
              size: info.size,
              mime: sticker.mime,
              width: sticker.width,
              height: sticker.height,
            },
          });
        }
      });
    });
  }

  async list(
    offset = 0,
    limit = 100,
  ): Promise<{ stickers: ChatSticker[]; next: number | null }> {
    await this.seed();
    const rows = this.repo.stickers(offset, limit + 1);
    return {
      stickers: rows.slice(0, limit),
      next: rows.length > limit ? offset + limit : null,
    };
  }
  async prepareImage(
    user: string,
    upload: string,
  ): Promise<{ image: ChatImage; thumbnail: Uint8Array }> {
    return this.prepareImportedImage(
      this.options.uploads.getCommitted(user, upload),
    );
  }
  /** Migration adapter; the original is already published in the object store. */
  async prepareImportedImage(
    info: ObjectInfo,
  ): Promise<{ image: ChatImage; thumbnail: Uint8Array }> {
    return this.images.run(async () => {
      if (info.size > CHAT_IMAGE_LIMIT)
        throw new AppError("E_TOO_LARGE", "图片不能超过 12 MiB");
      const bytes = await this.options.store.readAll(info.id);
      const mime = sniffImage(bytes);
      if (!mime)
        throw new AppError(
          "E_INVALID",
          "不支持的图片格式，请使用 PNG、JPEG、GIF 或 BMP",
        );
      try {
        validateImageBounds(bytes, mime);
        let input: Sharp;
        if (mime === "image/bmp") {
          const bmp = decodeBmp(bytes);
          input = sharp(bmp.data, {
            raw: { width: bmp.width, height: bmp.height, channels: 4 },
            limitInputPixels: 32_000_000,
          });
        } else {
          input = sharp(bytes, {
            limitInputPixels: 32_000_000,
            failOn: "error",
          });
        }
        const meta = await input.metadata();
        // EXIF orientations 5-8 swap the displayed axes.
        const swapped = (meta.orientation ?? 1) >= 5;
        const width = (swapped ? meta.height : meta.width) ?? 0;
        const height = (swapped ? meta.width : meta.height) ?? 0;
        if (width * height > 32_000_000 || !width || !height)
          throw new AppError("E_TOO_LARGE", "图片像素过多");
        // Animated sources use their first frame (sharp's default page).
        const { data: thumbnail, info: out } = await input
          .autoOrient()
          .resize({
            width: 480,
            height: 480,
            fit: "inside",
            withoutEnlargement: true,
          })
          .flatten({ background: "#ffffff" })
          .jpeg({ quality: 82 })
          .toBuffer({ resolveWithObject: true });
        return {
          image: {
            original: { rid: info.id, size: info.size, mime, width, height },
            thumbnail: {
              rid: sha256Hex(thumbnail),
              size: thumbnail.byteLength,
              mime: "image/jpeg",
              width: out.width,
              height: out.height,
            },
          },
          thumbnail,
        };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError("E_INVALID", "图片损坏或无法解码");
      }
    });
  }
  async fetch(args: {
    rid: string;
    offset: number;
    limit?: number;
  }): Promise<BodyChunk> {
    const info = await this.options.store.stat(args.rid);
    if (!info)
      throw new AppError("E_NOT_FOUND", "原始文件已丢失，请联系管理员");
    if (args.offset > info.size)
      throw new AppError("E_INVALID", "文件读取位置无效");
    const end = Math.min(info.size, args.offset + (args.limit ?? 512 * 1024));
    return {
      data: { size: info.size, offset: args.offset, eof: end === info.size },
      body: await this.options.store.readAll(args.rid, {
        start: args.offset,
        end,
      }),
    };
  }
}
function sniffImage(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
  if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return "image/gif";
  if (bytes[0] === 66 && bytes[1] === 77) return "image/bmp";
  return undefined;
}
