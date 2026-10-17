import type { Migration } from "../../kernel/persistence/db.ts";
export const authorityMigrations: readonly Migration[] = [
  {
    n: 1,
    up(db) {
      db.exec(`
CREATE TABLE authority_access(user_id TEXT PRIMARY KEY,roles TEXT NOT NULL CHECK(json_valid(roles)),features TEXT NOT NULL CHECK(json_valid(features)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))) STRICT;
CREATE INDEX authority_access_rev ON authority_access(user_id,rev);
CREATE TABLE authority_grants(id TEXT PRIMARY KEY,resource TEXT NOT NULL,principal_type TEXT NOT NULL CHECK(principal_type IN('user','group')),principal TEXT NOT NULL,level TEXT NOT NULL CHECK(level IN('read','write','own')),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),UNIQUE(resource,principal_type,principal)) STRICT;
CREATE INDEX authority_grants_rev ON authority_grants(principal,rev);
`);
    },
  },
  {
    n: 2,
    up(db) {
      db.exec(`
CREATE TABLE authority_grant_projections(user_id TEXT NOT NULL,grant_id TEXT NOT NULL REFERENCES authority_grants(id),rev INTEGER NOT NULL,deleted INTEGER NOT NULL CHECK(deleted IN(0,1)),PRIMARY KEY(user_id,grant_id)) STRICT;
CREATE INDEX authority_grant_projections_rev ON authority_grant_projections(user_id,rev);
CREATE INDEX authority_grant_projections_grant ON authority_grant_projections(grant_id);
`);
    },
  },
];
