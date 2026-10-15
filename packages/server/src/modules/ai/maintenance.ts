import type { Db } from "../../kernel/persistence/db.ts";
/** Keeps text referenced by live drafts, even beyond the staging TTL. */
export function aiMaintenance(db: Db): (now: number, ttlMs: number) => void {
  return (now, ttlMs) => {
    db.run(
      "DELETE FROM ai_texts WHERE updated<=? AND NOT EXISTS (SELECT 1 FROM ai_rows r WHERE r.user=ai_texts.user AND r.type='aiDraft' AND r.deleted=0 AND json_extract(r.data,'$.textId')=ai_texts.id)",
      now - ttlMs,
    );
  };
}
