import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { Db, migrate } from "./db.ts";
import { Uow } from "./uow.ts";
describe("Db and Uow", () => {
  it("opens a snapshot read-only and closes without checkpointing the source", async () => {
    const root = await mkdtemp(join(tmpdir(), "talos-readonly-"));
    const path = join(root, "snapshot.db");
    const source = new Db(path);
    try {
      source.exec("CREATE TABLE test(value INTEGER) STRICT");
      source.run("INSERT INTO test VALUES(7)");
      source.checkpoint();
      const snapshot = new Db(path, 5000, true);
      try {
        expect(snapshot.all("SELECT * FROM test")).toEqual([{ value: 7 }]);
        expect(() => snapshot.run("INSERT INTO test VALUES(8)")).toThrow();
      } finally {
        snapshot.close();
      }
      expect(source.all("SELECT * FROM test")).toEqual([{ value: 7 }]);
    } finally {
      source.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it("sets pragmas, caches statements and nests savepoints", () => {
    const db = new Db();
    db.exec("CREATE TABLE test(id INTEGER PRIMARY KEY) STRICT");
    expect(db.prepare("SELECT 1")).toBe(db.prepare("SELECT 1"));
    expect(
      db.get<{ foreign_keys: number }>("PRAGMA foreign_keys")?.foreign_keys,
    ).toBe(1);
    db.tx(() => {
      db.run("INSERT INTO test VALUES(1)");
      expect(() =>
        db.tx(() => {
          db.run("INSERT INTO test VALUES(2)");
          throw new Error();
        }),
      ).toThrow();
      db.tx(() => db.run("INSERT INTO test VALUES(3)"));
    });
    expect(db.all("SELECT * FROM test")).toEqual([{ id: 1 }, { id: 3 }]);
    expect(() => db.tx(() => Promise.resolve())).toThrow();
    db.close();
  });
  it("migrates transactionally and rejects unknown future versions and gaps", () => {
    const db = new Db();
    const one = {
      n: 1,
      up: (db: Db) => db.exec("CREATE TABLE test(x INTEGER) STRICT"),
    };
    migrate(db, "test", [one], () => 123);
    expect(() => migrate(db, "test", [])).toThrow();
    expect(() =>
      migrate(db, "test", [
        one,
        {
          n: 2,
          up: (db) => {
            db.run("INSERT INTO test VALUES(1)");
            throw new Error();
          },
        },
      ]),
    ).toThrow();
    expect(db.all("SELECT * FROM test")).toEqual([]);
    expect(db.all("SELECT * FROM _migrations")).toEqual([
      { module: "test", n: 1, applied_at: 123 },
    ]);
    expect(() => migrate(db, "other", [{ n: 2, up: () => {} }])).toThrow();
    db.close();
  });
  it("discards rolled-back revisions, changes and effects, isolates nested failures", () => {
    const db = new Db();
    const sets: unknown[] = [];
    const effects: string[] = [];
    const uow = new Uow(db, { committed: (s) => sets.push(s) });
    expect(() =>
      uow.write((ctx) => {
        ctx.changed("a", "b", "c");
        ctx.afterCommit(() => {
          effects.push("bad");
        });
        throw new Error();
      }),
    ).toThrow();
    expect(uow.revision).toBe(0);
    expect(sets).toEqual([]);
    expect(effects).toEqual([]);
    uow.write((ctx) => {
      ctx.changed("a", "b", "c");
      ctx.changed("a", "b", "c");
      expect(() =>
        uow.write((inner) => {
          inner.changed("x", "x", "x");
          inner.afterCommit(() => {
            effects.push("bad");
          });
          throw new Error();
        }),
      ).toThrow();
      uow.write((inner) => {
        expect(inner.rev).toBe(ctx.rev);
        inner.afterCommit(() => {
          effects.push("ok");
        });
      });
    });
    expect(sets).toEqual([
      { rev: 1, changes: [{ scope: "a", type: "b", id: "c" }] },
    ]);
    expect(effects).toEqual(["ok"]);
    expect(() => db.tx(() => uow.write(() => {}))).toThrow();
    db.close();
  });
  it("does not misreport committed changes when a post-commit effect fails", () => {
    const db = new Db();
    let errors = 0;
    const uow = new Uow(
      db,
      {
        committed: () => {
          throw new Error();
        },
      },
      () => errors++,
    );
    expect(
      uow.write((c) => {
        c.afterCommit(() => {
          throw new Error();
        });
        return "ok";
      }),
    ).toBe("ok");
    expect(errors).toBe(2);
    expect(uow.revision).toBe(1);
    db.close();
  });
  it("backs up a live WAL database and checkpoints on close", async () => {
    const dir = await mkdtemp(join(tmpdir(), "talos-db-"));
    try {
      const path = join(dir, "data.db");
      const db = new Db(path);
      db.exec(
        "CREATE TABLE test(x INTEGER) STRICT; INSERT INTO test VALUES(7)",
      );
      await db.backupTo(join(dir, "copy.db"));
      db.close();
      const copy = new Db(join(dir, "copy.db"));
      expect(copy.get("SELECT * FROM test")).toEqual({ x: 7 });
      copy.close();
      const reopened = new Db(path);
      expect(reopened.get("SELECT * FROM test")).toEqual({ x: 7 });
      reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

it("reports asynchronous post-commit rejection without unhandled promises", async () => {
  const db = new Db();
  const failures: unknown[] = [];
  const uow = new Uow(db, { committed: () => {} }, (error) =>
    failures.push(error),
  );
  uow.write((ctx) =>
    ctx.afterCommit(async () => {
      throw new Error("effect failure");
    }),
  );
  await Promise.resolve();
  expect(failures).toHaveLength(1);
  expect(uow.revision).toBe(1);
  db.close();
});

it("rolls back the entire pending schema batch when a later migration fails", () => {
  const db = new Db();
  try {
    const pending = [
      { n: 1, up: (db: Db) => db.exec("CREATE TABLE batch_schema(x INTEGER)") },
      {
        n: 2,
        up: () => {
          throw new Error("migration failed");
        },
      },
    ];
    expect(() => migrate(db, "batch", pending)).toThrow("migration failed");
    expect(db.all("SELECT * FROM _migrations WHERE module='batch'")).toEqual(
      [],
    );
    expect(
      db.get("SELECT 1 FROM sqlite_master WHERE name='batch_schema'"),
    ).toBeUndefined();
    migrate(db, "batch", [
      pending[0]!,
      { n: 2, up: (db) => db.run("INSERT INTO batch_schema VALUES(7)") },
    ]);
    expect(db.all("SELECT * FROM batch_schema")).toEqual([{ x: 7 }]);
  } finally {
    db.close();
  }
});
