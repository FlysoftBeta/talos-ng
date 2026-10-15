import { expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFsObjectStore } from "@talos/objectstore";
import { Db, Uow, ObjectLedger } from "@talos/server/migration";
import { ImportObjectBatch } from "./object-batch.ts";

it("commits imported ownership after the sync pass, isolates bad rows, and replays an interrupted batch", async () => {
  const root = await mkdtemp(join(tmpdir(), "talos-import-bulk-"));
  const db = new Db(join(root, "talos.db"));
  const store = createFsObjectStore({ root });
  const uow = new Uow(db, { committed: () => {} });
  const objects = new ObjectLedger({ db, store, uow });
  const kernel = { store, uow, objects };
  const failures: unknown[] = [];
  const produce = async (batch: ImportObjectBatch) => {
    for (let n = 0; n < 120; n++)
      await batch.publish(
        (put) => put(Buffer.from(String(n))),
        (info) => {
          objects.addRef(info.id, "fixture", String(n));
          if (n === 50) throw new Error("invalid imported row");
        },
        (error) => {
          failures.push(error);
        },
      );
  };
  try {
    await produce(new ImportObjectBatch(kernel)); // interrupted before durability/SQL commit
    expect(db.all("SELECT * FROM objects")).toHaveLength(0);
    const replay = new ImportObjectBatch(kernel);
    await produce(replay);
    expect(db.all("SELECT * FROM object_refs")).toHaveLength(0);
    await replay.flush();
    expect(uow.revision).toBe(1);
    expect(db.all("SELECT * FROM objects")).toHaveLength(119);
    expect(db.all("SELECT * FROM object_refs")).toHaveLength(119);
    expect(failures).toHaveLength(1);
    for (const { id } of db.all<{ id: string }>("SELECT id FROM objects"))
      expect(await store.verify(id)).toBe(true);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
