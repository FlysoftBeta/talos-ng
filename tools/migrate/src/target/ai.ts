import { ImportObjectBatch } from "./object-batch.ts";
import { extractTreeZip } from "../legacy/ai-workspace.ts";
import { closeSync, createReadStream, openSync, readSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Db, createKernel } from "@talos/server/migration";

import type { Options } from "../types.ts";
import { issue } from "../journal.ts";
import { legacyBlobPath } from "../legacy/blobs.ts";

export async function retainWorkspaces(
  target: Db,
  kernel: ReturnType<typeof createKernel>,
  options: Options,
): Promise<void> {
  const batch = new ImportObjectBatch(kernel);
  let cursor = "";
  for (;;) {
    const rows = target.all<{ legacy_id: string; blob_id: string }>(
      "SELECT legacy_id,blob_id FROM migration_workspace_rows WHERE object_id IS NULL AND legacy_id>? ORDER BY legacy_id LIMIT 100",
      cursor,
    );
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.legacy_id;
      if (!row.blob_id) continue;
      const failed = (error: unknown): void => {
        issue(
          target,
          "ai_workspaces",
          row.legacy_id,
          `workspace blob: ${error instanceof Error ? error.message : String(error)}`,
        );
      };
      try {
        const path = legacyBlobPath(options.blobs, row.blob_id);
        await stat(path);
        await batch.publish(
          (put) => put(createReadStream(path)),
          (info) => {
            kernel.objects.addRef(
              info.id,
              "migration-ai-workspace",
              row.legacy_id,
            );
            target.run(
              "UPDATE migration_workspace_rows SET object_id=? WHERE legacy_id=?",
              info.id,
              row.legacy_id,
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
export async function importWorkspaceFiles(
  target: Db,
  options: Options,
  kernel: ReturnType<typeof createKernel>,
): Promise<void> {
  const batch = new ImportObjectBatch(kernel);
  let cursor = "";
  for (;;) {
    const rows = target.all<{
      legacy_id: string;
      user_id: string;
      blob_id: string;
    }>(
      "SELECT legacy_id,user_id,blob_id FROM migration_workspace_rows WHERE object_id IS NOT NULL AND legacy_id>? ORDER BY legacy_id LIMIT 100",
      cursor,
    );
    if (!rows.length) break;
    for (const row of rows) {
      cursor = row.legacy_id;
      if (!row.blob_id) continue;
      const temporary = await mkdtemp(join(tmpdir(), "talos-migrate-ai-"));
      const failed = (error: unknown): void => {
        issue(
          target,
          "ai_workspaces",
          row.legacy_id,
          `workspace extraction: ${error instanceof Error ? error.message : String(error)}`,
        );
      };
      try {
        const files = await extractTreeZip(
          legacyBlobPath(options.blobs, row.blob_id),
          temporary,
        );
        let pendingFiles = 0;
        for (const file of files) {
          if (
            target.get(
              "SELECT 1 FROM migration_workspace_files WHERE user_id=? AND path=?",
              row.user_id,
              file.path,
            )
          )
            continue;
          await batch.publish(
            (put) =>
              put(createReadStream(file.temporary), {
                id: file.sha256,
                size: file.size,
              }),
            (info) => {
              kernel.objects.addRef(
                info.id,
                "ai.workspace",
                `${row.user_id}:${file.path}`,
              );
              const r = kernel.uow.current!.rev;
              target.run(
                "INSERT INTO ai_files(user,path,mime,bytes,rev) VALUES(?,?,?,zeroblob(0),?)",
                row.user_id,
                file.path,
                file.mime,
                r,
              );
              const handle = openSync(file.temporary, "r");
              try {
                const buffer = Buffer.allocUnsafe(64 * 1024);
                let at = 0;
                for (;;) {
                  const size = readSync(handle, buffer, 0, buffer.length, at);
                  if (!size) break;
                  at += size;
                  target.run(
                    "UPDATE ai_files SET bytes=CAST(bytes||? AS BLOB) WHERE user=? AND path=?",
                    buffer.subarray(0, size),
                    row.user_id,
                    file.path,
                  );
                }
              } finally {
                closeSync(handle);
              }
              target.run(
                "INSERT INTO migration_workspace_files VALUES(?,?,?)",
                row.user_id,
                file.path,
                file.sha256,
              );
            },
            failed,
          );
          if (++pendingFiles % 100 === 0) await batch.flush();
        }
      } catch (error) {
        failed(error);
      } finally {
        await batch.flush();
        for (let attempt = 0; attempt < 4; attempt++)
          try {
            await rm(temporary, { recursive: true, force: true });
            break;
          } catch (error) {
            if (
              attempt === 3 ||
              !["EBUSY", "EPERM"].includes(
                (error as NodeJS.ErrnoException).code ?? "",
              )
            )
              throw error;
            await new Promise((resolve) =>
              setTimeout(resolve, 50 * (attempt + 1)),
            );
          }
      }
    }
  }
}
