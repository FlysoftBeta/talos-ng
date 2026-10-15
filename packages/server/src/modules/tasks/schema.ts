import type { Migration } from "../../kernel/persistence/db.ts";
/** The tasks projection owns no tables. Its durable rows belong to kernel.jobs. */
export const tasksMigrations: readonly Migration[] = [];
