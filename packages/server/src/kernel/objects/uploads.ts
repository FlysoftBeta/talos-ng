import { UPLOAD_LIMITS, MAX_CHUNK_BYTES } from "@talos/contract";
import { AppError, createUlid, isUlid, Semaphore } from "@talos/base";
import type { ObjectStore } from "@talos/objectstore";
import { migrate } from "../persistence/db.ts";
import type { Db } from "../persistence/db.ts";
import type { Uow } from "../persistence/uow.ts";
import type { ObjectLedger } from "./objects.ts";

export { UPLOAD_LIMITS } from "@talos/contract";
export interface UploadBegin {
  id?: string;
  kind: keyof typeof UPLOAD_LIMITS;
  size: number;
  sha256?: string;
}
interface UploadRow {
  id: string;
  owner: string;
  kind: string;
  size: number;
  sha256: string | null;
  object_id: string | null;
  updated: number;
}
export interface UploadOptions {
  assertOwnerWritable?(user: string): void;
  db: Db;
  uow: Uow;
  ledger: ObjectLedger;
  store: ObjectStore;
  clock?: () => number;
  id?: () => string;
  limits?: Partial<typeof UPLOAD_LIMITS>;
  stageTtlMs?: number;
  refTtlMs?: number;
}
export class UploadService {
  private readonly clock: () => number;
  private readonly id: () => string;
  // One sequencer also makes stale-stage sweeping safe against in-flight appends.
  private readonly mutex = new Semaphore(1);
  constructor(private readonly options: UploadOptions) {
    for (const value of [
      options.stageTtlMs ?? 86_400_000,
      options.refTtlMs ?? 86_400_000,
      ...Object.values(options.limits ?? {}),
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0)
        throw new AppError("E_INVALID", "无效的上传限制");
    }
    this.clock = options.clock ?? Date.now;
    this.id = options.id ?? createUlid({ clock: this.clock });
    migrate(
      options.db,
      "uploads",
      [
        {
          n: 1,
          up: (db) =>
            db.exec(`CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL,
      sha256 TEXT, object_id TEXT REFERENCES objects(id), updated INTEGER NOT NULL
    ) STRICT; CREATE INDEX IF NOT EXISTS uploads_updated ON uploads(updated);`),
        },
      ],
      this.clock,
    );
  }
  downloadable(user: string, objectId: string): boolean {
    return !!this.options.db.get(
      "SELECT 1 FROM uploads WHERE owner=? AND object_id=?",
      user,
      objectId,
    );
  }
  private owned(user: string, id: string): UploadRow {
    this.options.assertOwnerWritable?.(user);
    const row = this.options.db.get<UploadRow>(
      "SELECT * FROM uploads WHERE id=?",
      id,
    );
    if (!row) throw new AppError("E_NOT_FOUND", "上传不存在或已过期");
    if (row.owner !== user) throw new AppError("E_DENIED", "无权访问此上传");
    return row;
  }
  async begin(
    user: string,
    args: UploadBegin,
  ): Promise<{ id: string; offset: number }> {
    return this.mutex.run(async () => {
      this.options.assertOwnerWritable?.(user);
      const limit =
        (this.options.limits ?? {})[args.kind] ?? UPLOAD_LIMITS[args.kind];
      if (
        !user ||
        !limit ||
        !Number.isSafeInteger(args.size) ||
        args.size < 0 ||
        (args.id !== undefined && !isUlid(args.id)) ||
        (args.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(args.sha256))
      )
        throw new AppError("E_INVALID", "无效的上传信息");
      if (args.size > limit) throw new AppError("E_TOO_LARGE", "上传文件过大");
      const id = args.id ?? this.id();
      const existing = this.options.db.get<UploadRow>(
        "SELECT * FROM uploads WHERE id=?",
        id,
      );
      if (existing) {
        this.owned(user, id);
        if (
          existing.kind !== args.kind ||
          existing.size !== args.size ||
          existing.sha256 !== (args.sha256 ?? null)
        )
          throw new AppError("E_CONFLICT", "上传信息与已有上传不一致");
        if (existing.object_id) return { id, offset: existing.size };
      } else {
        this.options.uow.write(() =>
          this.options.db.run(
            "INSERT INTO uploads VALUES(?,?,?,?,?,NULL,?)",
            id,
            user,
            args.kind,
            args.size,
            args.sha256 ?? null,
            this.clock(),
          ),
        );
      }
      const stage = await this.options.store.stage(id);
      await stage.append(new Uint8Array(), stage.size);
      this.options.db.run(
        "UPDATE uploads SET updated=? WHERE id=?",
        this.clock(),
        id,
      );
      return { id, offset: stage.size };
    });
  }
  async append(
    user: string,
    args: { id: string; offset: number },
    bytes: Uint8Array,
  ): Promise<{ offset: number }> {
    return this.mutex.run(async () => {
      this.options.assertOwnerWritable?.(user);
      const row = this.owned(user, args.id);
      if (row.object_id) throw new AppError("E_CONFLICT", "上传已提交");
      if (!Number.isSafeInteger(args.offset) || args.offset < 0)
        throw new AppError("E_INVALID", "无效的上传位置");
      if (
        bytes.length > MAX_CHUNK_BYTES ||
        args.offset + bytes.length > row.size
      )
        throw new AppError("E_TOO_LARGE", "上传分块过大");
      const stage = await this.options.store.stage(args.id);
      const offset = await stage.append(bytes, args.offset);
      this.options.db.run(
        "UPDATE uploads SET updated=? WHERE id=?",
        this.clock(),
        args.id,
      );
      return { offset };
    });
  }
  async commit(
    user: string,
    args: { id: string },
  ): Promise<{ id: string; object: { id: string; size: number } }> {
    return this.mutex.run(async () => {
      this.options.assertOwnerWritable?.(user);
      const row = this.owned(user, args.id);
      if (row.object_id)
        return { id: row.id, object: { id: row.object_id, size: row.size } };
      const stage = await this.options.store.stage(row.id);
      const object = await this.options.ledger.publish(
        () =>
          stage.commit({
            size: row.size,
            ...(row.sha256 ? { id: row.sha256 } : {}),
          }),
        (info) => {
          this.options.assertOwnerWritable?.(user);
          this.options.ledger.addRef(info.id, "upload", row.id);
          this.options.db.run(
            "UPDATE uploads SET object_id=?,updated=? WHERE id=?",
            info.id,
            this.clock(),
            row.id,
          );
        },
      );
      return { id: row.id, object };
    });
  }
  async abort(user: string, args: { id: string }): Promise<{ ok: true }> {
    return this.mutex.run(async () => {
      this.options.assertOwnerWritable?.(user);
      const existing = this.options.db.get<UploadRow>(
        "SELECT * FROM uploads WHERE id=?",
        args.id,
      );
      if (!existing) return { ok: true };
      const row = this.owned(user, args.id);
      if (!row.object_id)
        await (await this.options.store.stage(row.id)).abort();
      this.options.uow.write(() => this.remove(row));
      return { ok: true };
    });
  }
  getCommitted(user: string, id: string): { id: string; size: number } {
    const row = this.owned(user, id);
    if (!row.object_id) throw new AppError("E_CONFLICT", "上传尚未提交");
    return { id: row.object_id, size: row.size };
  }
  /** Claim must share the module's transaction with its owning row mutation. */
  claim(
    user: string,
    id: string,
    ownerKind: string,
    ownerId: string,
  ): { id: string; size: number } {
    if (!this.options.uow.current)
      throw new AppError("E_CONFLICT", "认领上传必须在写入事务中执行");
    const row = this.owned(user, id);
    if (!row.object_id) throw new AppError("E_CONFLICT", "上传尚未提交");
    this.options.ledger.addRef(row.object_id, ownerKind, ownerId);
    this.remove(row);
    return { id: row.object_id, size: row.size };
  }
  private remove(row: UploadRow): void {
    if (row.object_id)
      this.options.ledger.removeRef(row.object_id, "upload", row.id);
    this.options.db.run("DELETE FROM uploads WHERE id=?", row.id);
  }
  /** Drain the sequencer after the durable admission gate is closed. */
  async quiesce(): Promise<void> {
    await this.mutex.run(async () => {});
  }
  purgeUser(user: string): void {
    if (!this.options.uow.current)
      throw new AppError("E_CONFLICT", "上传清除必须在事务中执行");
    for (const row of this.options.db.all<UploadRow>(
      "SELECT * FROM uploads WHERE owner=?",
      user,
    ))
      this.remove(row);
    // Uncommitted stages are reclaimed by the existing repeatable stage sweep.
  }
  async sweep(): Promise<number> {
    return this.mutex.run(async () => {
      let count = 0;
      const rows = this.options.db.all<UploadRow>("SELECT * FROM uploads");
      for (const row of rows) {
        const ttl = row.object_id
          ? (this.options.refTtlMs ?? 86_400_000)
          : (this.options.stageTtlMs ?? 86_400_000);
        if (row.updated > this.clock() - ttl) continue;
        if (!row.object_id)
          await (await this.options.store.stage(row.id)).abort();
        this.options.uow.write(() => this.remove(row));
        count++;
      }
      // Reclaim crash leftovers absent from the SQL upload registry.
      await this.options.store.sweepStages(
        this.options.stageTtlMs ?? 86_400_000,
      );
      return count;
    });
  }
}
