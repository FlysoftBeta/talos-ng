import type { Migration } from "../../kernel/persistence/db.ts";
export const communityMigrations: readonly Migration[] = [
  {
    n: 1,
    up(db) {
      db.exec(`
CREATE TABLE community_conversations (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('group','dm')), type TEXT NOT NULL CHECK(type IN('normal','wild','announcement')),
 name TEXT NOT NULL, handle TEXT NOT NULL COLLATE NOCASE UNIQUE, parent TEXT REFERENCES community_conversations(id), owner TEXT,
 discoverable INTEGER NOT NULL CHECK(discoverable IN(0,1)), members_hidden INTEGER NOT NULL CHECK(members_hidden IN(0,1)),
 admin_only INTEGER NOT NULL CHECK(admin_only IN(0,1)), no_leave INTEGER NOT NULL CHECK(no_leave IN(0,1)), password_hash TEXT,
 pair_key TEXT UNIQUE, created INTEGER NOT NULL, rev INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))
) STRICT;
CREATE UNIQUE INDEX community_system_type ON community_conversations(type) WHERE type IN('wild','announcement');
CREATE INDEX community_conv_rev ON community_conversations(id,rev);
CREATE INDEX community_parent ON community_conversations(parent);
CREATE TABLE community_members (
 conversation TEXT NOT NULL REFERENCES community_conversations(id), user TEXT NOT NULL, hidden INTEGER NOT NULL CHECK(hidden IN(0,1)),
 joined INTEGER NOT NULL, rev INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)), PRIMARY KEY(conversation,user)
) STRICT;
CREATE INDEX community_members_user_rev ON community_members(user,rev);
CREATE INDEX community_members_conv_rev ON community_members(conversation,rev);
`);
    },
  },
];
