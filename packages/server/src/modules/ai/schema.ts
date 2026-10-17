import type { Migration } from "../../kernel/persistence/db.ts";
export const aiMigrations: readonly Migration[] = [
  {
    n: 1,
    up: (db) =>
      db.exec(`
CREATE TABLE ai_rows(user TEXT NOT NULL,type TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),PRIMARY KEY(user,type,id)) STRICT;
CREATE INDEX ai_rows_scope_rev ON ai_rows(user,rev,type,id);
CREATE TABLE ai_messages(id TEXT PRIMARY KEY,user TEXT NOT NULL,conversation TEXT NOT NULL,seq INTEGER NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN(0,1)),UNIQUE(conversation,seq)) STRICT;
CREATE INDEX ai_messages_scope_rev ON ai_messages(conversation,rev,id);
CREATE TABLE ai_runs(id TEXT PRIMARY KEY,user TEXT NOT NULL,conversation TEXT NOT NULL,message TEXT NOT NULL,job TEXT NOT NULL,state TEXT NOT NULL,reserved INTEGER NOT NULL,charged INTEGER NOT NULL DEFAULT 0,plan INTEGER NOT NULL,topup INTEGER NOT NULL,day TEXT NOT NULL,week TEXT NOT NULL,created INTEGER NOT NULL) STRICT;
CREATE UNIQUE INDEX ai_active_conversation ON ai_runs(conversation) WHERE state IN ('queued','running');
CREATE INDEX ai_runs_user ON ai_runs(user,day);
CREATE INDEX ai_runs_user_week ON ai_runs(user,week);
CREATE TABLE ai_accounts(user TEXT PRIMARY KEY,topup INTEGER NOT NULL DEFAULT 0 CHECK(topup>=0),plan_ends INTEGER NOT NULL DEFAULT 0) STRICT;
CREATE TABLE ai_policy(id INTEGER PRIMARY KEY CHECK(id=1),daily INTEGER NOT NULL,weekly INTEGER NOT NULL,days INTEGER NOT NULL) STRICT;
INSERT INTO ai_policy VALUES(1,100000000,300000000,30);
CREATE TABLE ai_ledger(id TEXT PRIMARY KEY,user TEXT NOT NULL,kind TEXT NOT NULL,amount INTEGER NOT NULL,note TEXT NOT NULL,created INTEGER NOT NULL,fingerprint TEXT NOT NULL) STRICT;
CREATE TABLE ai_files(user TEXT NOT NULL,path TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL,rev INTEGER NOT NULL,PRIMARY KEY(user,path)) STRICT;
CREATE TABLE ai_texts(id TEXT NOT NULL,user TEXT NOT NULL,total INTEGER NOT NULL,content TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(user,id)) STRICT;
CREATE TABLE ai_tools(run TEXT NOT NULL,call TEXT NOT NULL,result TEXT NOT NULL CHECK(json_valid(result)),PRIMARY KEY(run,call)) STRICT;
`),
  },
];
