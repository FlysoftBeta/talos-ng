import type { Migration } from "../../kernel/persistence/db.ts";
export const chatMigrations: readonly Migration[] = [
  {
    n: 1,
    up: (db) =>
      db.exec(`
CREATE TABLE chat_posts(id TEXT PRIMARY KEY, conversation TEXT NOT NULL, seq INTEGER NOT NULL CHECK(seq>0), author TEXT NOT NULL, body TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), rev INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)), UNIQUE(conversation,seq)) STRICT;
CREATE INDEX chat_posts_scope_rev ON chat_posts(conversation,rev);
CREATE TABLE chat_states(user TEXT NOT NULL, conversation TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), rev INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)), PRIMARY KEY(user,conversation)) STRICT;
CREATE INDEX chat_states_scope_rev ON chat_states(user,rev);
CREATE TABLE chat_texts(id TEXT PRIMARY KEY, user TEXT NOT NULL, total INTEGER NOT NULL CHECK(total BETWEEN 1 AND 5000000), body TEXT NOT NULL, updated INTEGER NOT NULL) STRICT;
CREATE TABLE chat_stickers(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
CREATE TABLE chat_announcements(id TEXT PRIMARY KEY CHECK(id='current'), data TEXT NOT NULL CHECK(json_valid(data)), rev INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))) STRICT;
CREATE INDEX chat_announcements_rev ON chat_announcements(rev);
CREATE TABLE chat_ack(user TEXT PRIMARY KEY, revision INTEGER NOT NULL, rev INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))) STRICT;
CREATE INDEX chat_ack_scope_rev ON chat_ack(user,rev);
CREATE TABLE chat_mutes(user TEXT PRIMARY KEY, until INTEGER NOT NULL, rev INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))) STRICT;
CREATE TRIGGER chat_post_identity BEFORE UPDATE OF id,conversation,seq,author ON chat_posts BEGIN SELECT RAISE(ABORT,'immutable post identity'); END;
CREATE TRIGGER chat_post_tombstone BEFORE UPDATE OF deleted ON chat_posts WHEN OLD.deleted=1 AND NEW.deleted=0 BEGIN SELECT RAISE(ABORT,'permanent tombstone'); END;
`),
  },
  { n: 2, up: (db) => db.exec("UPDATE chat_texts SET body=json_quote(body)") },
];
