import { sourceRows } from "../legacy/readers.ts";
import type { Db } from "@talos/server/migration";
import { AppError } from "@talos/base";
import { aiImageSchema, type AiMessage } from "@talos/contract";
import { exists, type LegacyDb } from "../legacy/db.ts";
import { validTreePath } from "../legacy/ai-workspace.ts";
import { issue, mapId, rev } from "../journal.ts";
import { value, json } from "../values.ts";
/** Legacy attachments are paths in the user's tree ZIP, not independent upload blobs. */
export function importAttachments(source: LegacyDb, target: Db): void {
  if (!exists(source, "ai_messages")) return;
  for (let offset = 0; ; offset += 500) {
    const rows = sourceRows(source, "ai_messages", offset);
    if (!rows.length) break;
    target.tx(() => {
      for (const row of rows) {
        const legacyId = value(row, "id"),
          id = mapId(target, "ai_messages", legacyId);
        const saved = target.get<{ user: string; data: string }>(
          "SELECT user,data FROM ai_messages WHERE id=?",
          id,
        );
        if (!saved) continue;
        const parsed = json(row.attachments_json, []);
        if (!Array.isArray(parsed)) {
          issue(target, "ai_messages", legacyId, "Invalid attachment array");
          continue;
        }
        const images: AiMessage["images"] = [];
        for (const entry of parsed as unknown[]) {
          try {
            if (
              !entry ||
              typeof entry !== "object" ||
              !("path" in entry) ||
              !validTreePath(String(entry.path))
            )
              throw new AppError("E_INVALID", "Invalid attachment path");
            const path = String(entry.path),
              file = target.get<{ mime: string; size: number }>(
                "SELECT mime,length(bytes) size FROM ai_files WHERE user=? AND path=?",
                saved.user,
                path,
              );
            if (!file)
              throw new AppError(
                "E_NOT_FOUND",
                `Attachment workspace file missing: ${path}`,
              );
            const meta = entry as { mime?: unknown; size?: unknown };
            if (meta.mime !== file.mime || meta.size !== file.size)
              throw new AppError(
                "E_INTEGRITY",
                `Attachment metadata differs: ${path}`,
              );
            images.push(
              aiImageSchema.parse({ path, mime: file.mime, size: file.size }),
            );
          } catch (error) {
            issue(
              target,
              "ai_messages",
              legacyId,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        const message = JSON.parse(saved.data) as AiMessage;
        target.run(
          "UPDATE ai_messages SET data=?,rev=? WHERE id=?",
          JSON.stringify({ ...message, images }),
          rev(target),
          id,
        );
      }
    });
  }
}
