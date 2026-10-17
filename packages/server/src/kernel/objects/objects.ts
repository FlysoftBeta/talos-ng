import { AppError, Semaphore } from "@talos/base";
import { isObjectId } from "@talos/objectstore";
import type { ObjectInfo, ObjectStore } from "@talos/objectstore";
import { migrate } from "../persistence/db.ts";
import type { Db } from "../persistence/db.ts";
import type { Uow } from "../persistence/uow.ts";

export interface ObjectLedgerOptions {
  db: Db;
  uow: Uow;
  store: ObjectStore;
  clock?: () => number;
  graceMs?: number;
}
export interface FsckReport {
  imported: string[];
  missing: string[];
  corrupt: string[];
}
/** SQL reference ownership is transactional; asynchronous deletion reserves each object. */
export class ObjectLedger {
  has(id: string): boolean {
    return !!this.options.db.get("SELECT 1 FROM objects WHERE id=?", id);
  }

  private readonly clock: () => number;
  private readonly maintenance = new Semaphore(1);
  constructor(private readonly options: ObjectLedgerOptions) {
    if (
      !Number.isSafeInteger(options.graceMs ?? 86_400_000) ||
      (options.graceMs ?? 86_400_000) < 0
    )
      throw new AppError("E_INVALID", "无效的对象保留期限");
    this.clock = options.clock ?? Date.now;
    migrate(
      options.db,
      "objects",
      [
        {
          n: 1,
          up: (db) =>
            db.exec(`
      CREATE TABLE IF NOT EXISTS objects (
        id TEXT PRIMARY KEY, size INTEGER NOT NULL CHECK(size >= 0),
        created INTEGER NOT NULL, last_ref_change INTEGER NOT NULL,
        deleting INTEGER NOT NULL DEFAULT 0 CHECK(deleting IN (0,1))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS object_refs (
        object_id TEXT NOT NULL REFERENCES objects(id), owner_kind TEXT NOT NULL,
        owner_id TEXT NOT NULL, PRIMARY KEY(object_id,owner_kind,owner_id)
      ) STRICT;
    `),
        },
      ],
      this.clock,
    );
    // A previous process may have stopped between reservation and deletion.
    // (Read-only replicas leave recovery to the writer.)
    if (!options.db.isReadOnly)
      options.db.run("UPDATE objects SET deleting=0 WHERE deleting=1");
  }
  private requireWrite(): void {
    if (!this.options.uow.current)
      throw new AppError("E_CONFLICT", "对象引用必须在写入事务中修改");
  }
  register(info: ObjectInfo): void {
    this.requireWrite();
    if (
      !isObjectId(info.id) ||
      !Number.isSafeInteger(info.size) ||
      info.size < 0
    )
      throw new AppError("E_INVALID", "无效的对象信息");
    const existing = this.options.db.get<{ size: number; deleting: number }>(
      "SELECT size,deleting FROM objects WHERE id=?",
      info.id,
    );
    if (existing?.deleting) throw new AppError("E_BUSY", "对象正在清理");
    if (existing && existing.size !== info.size)
      throw new AppError("E_INTEGRITY", "对象大小不匹配");
    this.options.db.run(
      "INSERT OR IGNORE INTO objects(id,size,created,last_ref_change) VALUES(?,?,?,?)",
      info.id,
      info.size,
      this.clock(),
      this.clock(),
    );
  }
  addRef(objectId: string, ownerKind: string, ownerId: string): void {
    this.requireWrite();
    if (!ownerKind || !ownerId)
      throw new AppError("E_INVALID", "无效的对象引用");
    const row = this.options.db.get<{ deleting: number }>(
      "SELECT deleting FROM objects WHERE id=?",
      objectId,
    );
    if (!row) throw new AppError("E_NOT_FOUND", "对象不存在");
    if (row.deleting) throw new AppError("E_BUSY", "对象正在清理");
    this.options.db.run(
      "INSERT OR IGNORE INTO object_refs VALUES(?,?,?)",
      objectId,
      ownerKind,
      ownerId,
    );
    this.options.db.run(
      "UPDATE objects SET last_ref_change=? WHERE id=?",
      this.clock(),
      objectId,
    );
  }
  removeRef(objectId: string, ownerKind: string, ownerId: string): void {
    this.requireWrite();
    this.options.db.run(
      "DELETE FROM object_refs WHERE object_id=? AND owner_kind=? AND owner_id=?",
      objectId,
      ownerKind,
      ownerId,
    );
    this.options.db.run(
      "UPDATE objects SET last_ref_change=? WHERE id=?",
      this.clock(),
      objectId,
    );
  }
  removeOwnerRefs(ownerKind: string, ownerId: string): void {
    this.requireWrite();
    for (const row of this.options.db.all<{ object_id: string }>(
      "SELECT object_id FROM object_refs WHERE owner_kind=? AND owner_id=?",
      ownerKind,
      ownerId,
    ))
      this.removeRef(row.object_id, ownerKind, ownerId);
  }
  /** Publish and retain share the GC sequencer, so identical-object deduplication cannot race deletion. */
  async publish(
    produce: () => Promise<ObjectInfo>,
    retain: (info: ObjectInfo) => void,
  ): Promise<ObjectInfo> {
    return this.maintenance.run(async () => {
      const info = await produce();
      this.options.uow.write(() => {
        this.register(info);
        retain(info);
      });
      return info;
    });
  }
  /** Pin immutable objects against GC for a consistent database/object snapshot. */
  snapshot<T>(read: () => Promise<T>): Promise<T> {
    return this.maintenance.run(read);
  }
  async sweep(): Promise<number> {
    return this.collect(this.clock() - (this.options.graceMs ?? 86_400_000));
  }
  /** Explicit domain deletion bypasses orphan grace, but never live references or publication. */
  async reclaim(ids: readonly string[]): Promise<number> {
    return this.collect(this.clock(), new Set(ids));
  }
  private async collect(
    cutoff: number,
    ids?: ReadonlySet<string>,
  ): Promise<number> {
    return this.maintenance.run(async () => {
      const { db, store, uow } = this.options;
      const candidates = db.all<{ id: string }>(
        "SELECT id FROM objects WHERE deleting=0 AND last_ref_change<=? AND NOT EXISTS(SELECT 1 FROM object_refs WHERE object_id=objects.id)",
        cutoff,
      );
      let removed = 0;
      for (const { id } of candidates) {
        if (ids && !ids.has(id)) continue;
        const reserved = uow.write(() => {
          if (
            !db.get(
              "SELECT 1 FROM objects WHERE id=? AND deleting=0 AND last_ref_change<=? AND NOT EXISTS(SELECT 1 FROM object_refs WHERE object_id=objects.id)",
              id,
              cutoff,
            )
          )
            return false;
          db.run("UPDATE objects SET deleting=1 WHERE id=?", id);
          return true;
        });
        if (!reserved) continue;
        try {
          await store.delete(id);
          uow.write(() => db.run("DELETE FROM objects WHERE id=?", id));
          removed++;
        } catch (error) {
          uow.write(() =>
            db.run("UPDATE objects SET deleting=0 WHERE id=?", id),
          );
          throw error;
        }
      }
      return removed;
    });
  }
  async fsck(): Promise<FsckReport> {
    return this.maintenance.run(async () => {
      const { db, store, uow } = this.options;
      const report: FsckReport = { imported: [], missing: [], corrupt: [] };
      for await (const object of store.list()) {
        if (!db.get("SELECT 1 FROM objects WHERE id=?", object.id)) {
          uow.write(() => this.register(object));
          report.imported.push(object.id);
        }
        if (!(await store.verify(object.id))) report.corrupt.push(object.id);
      }
      for (const { id } of db.all<{ id: string }>("SELECT id FROM objects")) {
        if (!(await store.has(id))) report.missing.push(id);
      }
      // Missing referenced objects remain in the ledger: fsck must never discard ownership.
      return report;
    });
  }
}
