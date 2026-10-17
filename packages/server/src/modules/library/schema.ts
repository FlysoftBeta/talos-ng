import type { Migration } from "../../kernel/persistence/db.ts";
export const libraryMigrations: readonly Migration[] = [
  {
    n: 1,
    up(db) {
      db.exec(`CREATE TABLE library_retentions(user_id TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),rev INTEGER NOT NULL,PRIMARY KEY(user_id,id)) STRICT;
CREATE INDEX library_retentions_rev ON library_retentions(user_id,rev,id);

CREATE TABLE library_documents(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),source TEXT NOT NULL,filename TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))) STRICT;
CREATE INDEX library_documents_rev ON library_documents(owner,rev,id);
CREATE TABLE library_collections(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL CHECK(json_valid(body)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1))) STRICT;
CREATE INDEX library_collections_rev ON library_collections(rev);
CREATE INDEX library_collections_owner ON library_collections(owner,rev,id);
CREATE TABLE library_states(user_id TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,body TEXT NOT NULL CHECK(json_valid(body)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),PRIMARY KEY(user_id,id)) STRICT;
CREATE INDEX library_states_rev ON library_states(user_id,rev,id);
CREATE INDEX library_states_doc ON library_states(id);
CREATE TABLE library_items(collection TEXT NOT NULL,id TEXT NOT NULL,rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),PRIMARY KEY(collection,id)) STRICT;
CREATE INDEX library_items_rev ON library_items(collection,rev,id);
CREATE INDEX library_items_doc ON library_items(id);
CREATE TABLE library_delegations(collection TEXT NOT NULL,principal_type TEXT NOT NULL,principal TEXT NOT NULL,delegable INTEGER NOT NULL CHECK(delegable IN(0,1)),PRIMARY KEY(collection,principal_type,principal)) STRICT;
`);
    },
  },
];
