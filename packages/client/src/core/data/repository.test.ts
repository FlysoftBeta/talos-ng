import { expect, it } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openAppDb } from "../../platform/storage/database.ts";
import type { StoredRow } from "./db.ts";
import { Repository } from "./repository.ts";
it("write-through repository publishes committed rows without hydrating other accounts", async () => {
  const db = await openAppDb({
    indexedDB: new IDBFactory(),
    keyRange: IDBKeyRange,
    channel: null,
  });
  const first: StoredRow = {
    scope: "me:alice",
    type: "setting",
    id: "theme",
    rev: 1,
    deleted: false,
    data: "light",
  };
  try {
    await db
      .table<StoredRow>("rows")
      .put({ ...first, scope: "me:bob", data: "secret" });
    const repository = new Repository((rows) => rows.map((row) => row.data));
    repository.hydrate([first]);
    let published = 0;
    repository.subscribe(() => published++);
    await repository.put(db, { ...first, rev: 2, data: "dark" });
    expect(repository.getSnapshot()).toEqual(["dark"]);
    expect(published).toBe(1);
    expect(
      (await db.table<StoredRow>("rows").get(["me:alice", "setting", "theme"]))!
        .data,
    ).toBe("dark");
    db.close();
    await expect(
      repository.put(db, { ...first, data: "failed" }),
    ).rejects.toThrow();
    expect(repository.getSnapshot()).toEqual(["dark"]);
    expect(published).toBe(1);
  } finally {
    db.close();
  }
});
