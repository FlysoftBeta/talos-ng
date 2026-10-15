import { ImportObjectBatch } from "./object-batch.ts";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Db, createKernel } from "@talos/server/migration";

import type { Options, LegacyRow } from "../types.ts";
import { LegacyDb, exists } from "../legacy/db.ts";
import { value, json } from "../values.ts";
import { mapId, issue } from "../journal.ts";
import { legacyBlobPath } from "../legacy/blobs.ts";

export async function materializeArticles(
  source: LegacyDb,
  target: Db,
  kernel: ReturnType<typeof createKernel>,
  options: Options,
): Promise<void> {
  const batch = new ImportObjectBatch(kernel);
  if (!exists(source, "articles")) return;
  for (let offset = 0; ; offset += 100) {
    const rows = source.all<LegacyRow>(
      "SELECT id,provider_json,title FROM articles ORDER BY rowid LIMIT 100 OFFSET ?",
      offset,
    );
    if (!rows.length) break;
    for (const row of rows) {
      const legacyId = value(row, "id"),
        id = mapId(target, "articles", legacyId);
      if (
        target.get(
          "SELECT 1 FROM migration_documents WHERE legacy_id=?",
          legacyId,
        )
      )
        continue;
      if (!target.get("SELECT 1 FROM library_documents WHERE id=?", id))
        continue;
      const failed = (error: unknown): void => {
        target.run(
          "INSERT OR IGNORE INTO migration_issues VALUES(?,?,?)",
          "articles",
          legacyId,
          `source conversion: ${error instanceof Error ? error.message : String(error)}`,
        );
      };
      try {
        const provider = json(row.provider_json, {}) as {
          type?: string;
          source_file?: string;
          source_mime?: string;
        };
        const chunks = async function* (): AsyncGenerator<Uint8Array> {
          for (let at = 0; ; at += 100) {
            const parts = target.all<{ content: string }>(
              "SELECT content FROM migration_text_segments WHERE article_id=? ORDER BY segment_index LIMIT 100 OFFSET ?",
              id,
              at,
            );
            if (!parts.length) break;
            for (const part of parts) yield Buffer.from(part.content, "utf8");
          }
        };
        const path =
          provider.type === "bundle"
            ? legacyBlobPath(options.blobs, provider.source_file ?? "")
            : null;
        if (path) await stat(path);
        await batch.publish(
          (put) => put(path ? createReadStream(path) : chunks()),
          (info) => {
            const doc = kernel.library.document(id);
            kernel.objects.addRef(info.id, "library.source", id);
            kernel.library.repo.attachImportedSource(
              id,
              info.id,
              path
                ? `${value(row, "title")}.${provider.source_mime?.startsWith("text/") ? "txt" : "pdf"}`
                : `${value(row, "title")}.txt`,
            );
            kernel.library.repo.putDoc(
              { ...doc, kind: null, status: "processing" },
              info.id,
              path
                ? `${value(row, "title")}.${provider.source_mime?.startsWith("text/") ? "txt" : "pdf"}`
                : `${value(row, "title")}.txt`,
              kernel.uow.current!.rev,
            );
            kernel.jobs.enqueue(
              doc.owner,
              "library.convert",
              { doc: id, title: doc.title },
              { runAfter: Date.now() + 86_400_000 },
            );
            target.run(
              "INSERT INTO migration_documents VALUES(?,?)",
              legacyId,
              info.id,
            );
          },
          failed,
        );
      } catch (error) {
        failed(error);
      }
    }
    await batch.flush();
  }
}
export function finishCollections(
  target: Db,
  kernel: ReturnType<typeof createKernel>,
  source: LegacyDb,
): void {
  let cursor = "";
  for (;;) {
    const rows = target.all<{ id: string }>(
      "SELECT id FROM library_collections WHERE id>? ORDER BY id LIMIT 500",
      cursor,
    );
    if (!rows.length) break;
    kernel.uow.write((ctx) => {
      for (const row of rows) {
        cursor = row.id;
        const collection = kernel.library.collection(row.id);
        const legacyId = target.get<{ legacy_id: string }>(
          "SELECT legacy_id FROM migration_map WHERE entity='booklists' AND new_id=?",
          row.id,
        )?.legacy_id;
        const docs: string[] = [];
        if (legacyId && exists(source, "booklist_items"))
          for (let at = 0; at < 1000; at += 500) {
            const items = source.all<{ article_id: string }>(
              "SELECT article_id FROM booklist_items WHERE booklist_id=? ORDER BY position LIMIT 500 OFFSET ?",
              legacyId,
              at,
            );
            for (const item of items) {
              const doc = mapId(target, "articles", item.article_id);
              if (
                target.get(
                  "SELECT 1 FROM library_items WHERE collection=? AND id=?",
                  row.id,
                  doc,
                )
              )
                docs.push(doc);
            }
          }
        if (
          target.get<{ n: number }>(
            "SELECT count(*) n FROM library_items WHERE collection=? AND deleted=0",
            row.id,
          )!.n > 1000
        )
          issue(
            target,
            "booklists",
            row.id,
            "collection exceeds 1,000-document target limit; remaining items retained only in library_items",
          );
        kernel.library.repo.putCollection({ ...collection, docs }, ctx.rev);
        ctx.changed(`coll:${row.id}`, "libraryCollection", row.id);
      }
    });
  }
}
