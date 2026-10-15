import type { Db } from "../../kernel/persistence/db.ts";
/** Keeps text referenced by live drafts, even beyond the staging TTL. */
export function chatMaintenance(db: Db): (now: number, ttlMs: number) => void {
  return (now, ttlMs) => {
    db.run(
      "DELETE FROM chat_texts WHERE updated<=? AND NOT EXISTS (SELECT 1 FROM chat_states s WHERE s.user=chat_texts.user AND s.deleted=0 AND json_extract(s.data,'$.draftTextId')=chat_texts.id)",
      now - ttlMs,
    );
  };
}
