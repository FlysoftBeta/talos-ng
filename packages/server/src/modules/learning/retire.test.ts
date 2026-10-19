import { afterEach, expect, it } from "vitest";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createKernel } from "../../app/create-application.ts";
import type { Kernel } from "../../app/create-application.ts";
import { Db } from "../../kernel/persistence/db.ts";

const opened: Kernel[] = [];
afterEach(async () => {
  for (const kernel of opened.splice(0)) await kernel.close();
});
function kernel(db: Db, store = createMemoryObjectStore()): Kernel {
  const k = createKernel({
    db,
    store,
    build: "test",
    dev: true,
    testSeed: true,
  });
  opened.push(k);
  return k;
}

it("removes learning tables, gates and the discipline setting from an existing database", async () => {
  const db = new Db();
  try {
    const store = createMemoryObjectStore();
    const first = kernel(db, store);
    const user = first.authority.repo.users()[0]!;
    first.authority.setAccess(user, { features: ["offline", "media"] });
    await first.close();
    opened.splice(0);
    // Put the database back into its state before the removal.
    db.exec(`
      DELETE FROM _migrations WHERE (module='learning' AND n=2) OR (module='authority' AND n=3) OR (module='identity' AND n=7) OR (module='me' AND n=2);
      CREATE TABLE learning_words(id TEXT PRIMARY KEY,english TEXT NOT NULL UNIQUE,definition TEXT NOT NULL) STRICT;
      CREATE TABLE learning_corpus(id TEXT PRIMARY KEY,body TEXT NOT NULL,rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0) STRICT;
      CREATE TABLE learning_progress(user_id TEXT NOT NULL REFERENCES users(id),word_id TEXT NOT NULL REFERENCES learning_words(id),body TEXT NOT NULL,rev INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,word_id)) STRICT;
      INSERT INTO learning_words VALUES('word','hello','你好');
    `);
    db.run("INSERT INTO learning_progress VALUES(?,'word','{}',1,0)", user);
    db.run(
      'UPDATE authority_access SET features=\'["offline","learning","media"]\' WHERE user_id=?',
      user,
    );
    db.run("UPDATE users SET features='[\"learning\"]' WHERE id=?", user);
    db.run(
      "INSERT INTO me_settings VALUES(?,'learning.discipline','{}',1,0),(?,'theme','{}',1,0)",
      user,
      user,
    );
    const second = kernel(db, store);
    expect(
      db.all("SELECT name FROM sqlite_master WHERE name LIKE 'learning%'"),
    ).toEqual([]);
    expect(second.authority.repo.actor(user)!.features).toEqual([
      "offline",
      "media",
    ]);
    expect(
      db.get<{ features: string }>(
        "SELECT features FROM users WHERE id=?",
        user,
      )!.features,
    ).toBe("[]");
    expect(
      db
        .all<{ key: string }>(
          "SELECT key FROM me_settings WHERE user_id=?",
          user,
        )
        .map((row) => row.key),
    ).toEqual(["theme"]);
  } finally {
    db.close();
  }
});
