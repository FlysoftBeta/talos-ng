import { ImportObjectBatch } from "./object-batch.ts";
import { sourceRows } from "../legacy/readers.ts";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Db, createKernel } from "@talos/server/migration";
import { AppError } from "@talos/base";

import type { Options } from "../types.ts";
import { LegacyDb, exists } from "../legacy/db.ts";
import { value } from "../values.ts";
import { mapId, issue } from "../journal.ts";
import { legacyBlobPath } from "../legacy/blobs.ts";

export async function materializeImages(
  source: LegacyDb,
  target: Db,
  kernel: ReturnType<typeof createKernel>,
  options: Options,
): Promise<void> {
  const batch = new ImportObjectBatch(kernel);
  if (!exists(source, "post_images")) return;
  for (let offset = 0; ; offset += 100) {
    const rows = sourceRows(source, "post_images", offset);
    if (!rows.length) break;
    for (const row of rows) {
      const legacyId = value(row, "id"),
        legacyPost = value(row, "post_id");
      if (
        target.get("SELECT 1 FROM migration_images WHERE legacy_id=?", legacyId)
      )
        continue;
      if (!legacyPost) {
        issue(
          target,
          "post_images",
          legacyId,
          "unattached staged image omitted",
        );
        continue;
      }
      const postId = mapId(target, "posts", legacyPost),
        post = kernel.chat.repo.post(postId);
      if (!post) {
        issue(target, "post_images", legacyId, "orphan image");
        continue;
      }
      const failed = (error: unknown): void => {
        issue(
          target,
          "post_images",
          legacyId,
          `image import: ${error instanceof Error ? error.message : String(error)}`,
        );
      };
      try {
        const path = legacyBlobPath(options.blobs, value(row, "blob_id"));
        const size = (await stat(path)).size;
        if (size > 12 * 1024 * 1024)
          throw new AppError("E_TOO_LARGE", "legacy image exceeds 12 MiB");
        const original = await batch.put(createReadStream(path), {
          id: value(row, "sha256"),
          size: Number(row.bytes),
        });
        const prepared =
          await kernel.chat.assets.prepareImportedImage(original);
        const thumbnail = await batch.put(prepared.thumbnail);
        batch.write(() => {
          const ctx = kernel.uow.current!;
          kernel.objects.register(original);
          kernel.objects.addRef(original.id, "chat-post", postId);
          kernel.objects.register(thumbnail);
          kernel.objects.addRef(thumbnail.id, "chat-post", postId);
          kernel.chat.repo.putPost(
            { ...post, kind: "image", image: prepared.image, rev: ctx.rev },
            kernel.chat.repo.body(postId) ?? "",
          );
          target.run(
            "INSERT INTO migration_images VALUES(?,?,?)",
            legacyId,
            original.id,
            thumbnail.id,
          );
          ctx.changed(`conv:${post.conversation}`, "post", postId);
        }, failed);
      } catch (error) {
        failed(error);
      }
    }
    await batch.flush();
  }
}
export async function materializeStickers(
  target: Db,
  kernel: ReturnType<typeof createKernel>,
): Promise<void> {
  if (!target.get("SELECT 1 FROM migration_sticker_refs WHERE done=0")) return;
  await kernel.chat.ready;
  let cursor = "";
  for (;;) {
    const rows = target.all<{
      post_id: string;
      pack: string;
      sticker_id: string;
    }>(
      "SELECT post_id,pack,sticker_id FROM migration_sticker_refs WHERE done=0 AND post_id>? ORDER BY post_id LIMIT 500",
      cursor,
    );
    if (!rows.length) break;
    kernel.uow.write((ctx) => {
      for (const row of rows) {
        cursor = row.post_id;
        const post = kernel.chat.repo.post(row.post_id);
        const sticker = kernel.chat.repo.sticker(
          `${row.pack}:${row.sticker_id}`,
        );
        if (!post || !sticker) {
          issue(
            target,
            "posts",
            row.post_id,
            "legacy sticker reference not in target catalog",
          );
          continue;
        }
        kernel.chat.repo.putPost(
          {
            ...post,
            kind: "sticker",
            sticker,
            bodyLength: 0,
            preview: `[表情] ${sticker.name}`.slice(0, 1000),
            rev: ctx.rev,
          },
          "",
        );
        target.run(
          "UPDATE migration_sticker_refs SET done=1 WHERE post_id=?",
          row.post_id,
        );
        ctx.changed(`conv:${post.conversation}`, "post", row.post_id);
      }
    });
  }
}
