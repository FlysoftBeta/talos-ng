import type { Migration } from "../persistence/db.ts";
/** Kernel-owned schema; modules/tasks only projects these rows. */
export const JOBS_SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  state TEXT NOT NULL CHECK(state IN ('queued','running','done','failed','cancelled')),
  progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 1),
  message TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'null' CHECK(json_valid(result)),
  error TEXT NOT NULL DEFAULT 'null' CHECK(json_valid(error)),
  attempts INTEGER NOT NULL DEFAULT 0,
  run_after INTEGER NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
) STRICT;
CREATE INDEX IF NOT EXISTS jobs_owner_rev ON jobs(owner, rev);
CREATE INDEX IF NOT EXISTS jobs_pending ON jobs(kind,state,run_after);
`;

export const jobsMigrations: readonly Migration[] = [
  { n: 1, up: (db) => db.exec(JOBS_SCHEMA) },
];
