import type { Db } from "../../kernel/persistence/db.ts";
import { migrate } from "../../kernel/persistence/db.ts";
import { learningMigrations } from "./schema.ts";
/** Drops the retired learning tables from databases that still have them. */
export function retireLearning(db: Db, now?: () => number): void {
  migrate(db, "learning", learningMigrations, now);
}
