import { AppError } from "@talos/base";
import { Db } from "@talos/server/migration";

import type { LegacyRow } from "../types.ts";
import { value, number, time } from "../values.ts";
import { rev, legacyUlid, mapId } from "../journal.ts";

export function importLearning(
  target: Db,
  table: string,
  row: LegacyRow,
  legacyId: string,
): string {
  const id = mapId(target, table, legacyId);
  const r = rev(target);
  const user = (key: string): string => mapId(target, "users", value(row, key));
  const hasUser = (id: string): boolean =>
    !!target.get("SELECT 1 FROM users WHERE id=?", id);
  switch (table) {
    case "words":
      target.run(
        "INSERT OR IGNORE INTO learning_words VALUES(?,?,?)",
        id,
        value(row, "english").slice(0, 128),
        value(row, "definition").slice(0, 2000),
      );
      break;
    case "user_word_progress": {
      const u = user("user_id"),
        w = mapId(target, "words", value(row, "word_id"));
      if (
        !hasUser(u) ||
        !target.get("SELECT 1 FROM learning_words WHERE id=?", w)
      )
        throw new AppError("E_INVALID", "orphan word progress");
      const body = {
        id: w,
        devices: {
          [legacyUlid("device", "legacy")]: {
            learned: number(row, "learned_count"),
            wrong: number(row, "wrong_count"),
            answered: number(row, "learned_count") + number(row, "wrong_count"),
            lastAt: time(row.last_practiced_at),
          },
        },
        cleared: {},
      };
      target.run(
        "INSERT OR REPLACE INTO learning_progress VALUES(?,?,?,?,0)",
        u,
        w,
        JSON.stringify(body),
        r,
      );
      break;
    }
  }
  return id;
}
