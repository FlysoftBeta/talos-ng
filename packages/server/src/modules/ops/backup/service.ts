import { BackupSnapshot } from "./snapshot.ts";
import type { BackupSnapshots } from "./snapshot.ts";
import { AppError, createUlid } from "@talos/base";
import { acquireLock } from "@talos/launcher";
import type { ObjectStore } from "@talos/objectstore";
import { createFsObjectStore } from "@talos/objectstore";
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { dataLayout } from "../../../kernel/config/config.ts";
import type { ObjectLedger } from "../../../kernel/objects/objects.ts";
import { Db } from "../../../kernel/persistence/db.ts";
import type { BackupRow, OpsRepo } from "../repo.ts";
import type { BackupEntry } from "./stream.ts";
import {
  BACKUP_MAGIC,
  BackupReader,
  copyChecked,
  entryLine,
  fileBytes,
  hashFile,
  parseEntry,
} from "./stream.ts";

/** Archive framing: magic, repeated JSON header LF + exactly size bytes + LF, END LF. */
export async function* archiveBackup(
  directory: string,
): AsyncIterable<Uint8Array> {
  yield Buffer.from(BACKUP_MAGIC);
  const manifest = new BackupReader(
    fileBytes(join(directory, "backup.ndjson")),
  );
  try {
    for (
      let line = await manifest.line();
      line !== undefined;
      line = await manifest.line()
    ) {
      const entry = parseEntry(line);
      yield entryLine(entry);
      yield* fileBytes(join(directory, entry.path));
      yield Buffer.from("\n");
    }
    yield Buffer.from("END\n");
  } finally {
    await manifest.close();
  }
}
export class Backups {
  private readonly id: () => string;
  private busy = false;
  private readonly readers = new Map<string, number>();
  private readonly deleting = new Set<string>();
  private completion = Promise.resolve();
  idle(): Promise<void> {
    return this.completion;
  }
  constructor(
    private readonly repo: Pick<
      OpsRepo,
      | "backups"
      | "addBackup"
      | "settings"
      | "deleteBackupDownloads"
      | "deleteBackup"
    >,
    private readonly store: ObjectStore,
    private readonly ledger: Pick<ObjectLedger, "snapshot">,
    readonly directory: string,
    private readonly now: () => number,
    private readonly snapshots: BackupSnapshots,
  ) {
    this.id = createUlid({ clock: now });
  }
  path(id: string): string {
    if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))
      throw new AppError("E_INVALID", "备份编号无效");
    if (!this.repo.backups().some((row) => row.id === id))
      throw new AppError("E_NOT_FOUND", "备份不存在");
    return join(this.directory, id + ".backup");
  }
  async *download(id: string): AsyncIterable<Uint8Array> {
    if (this.deleting.has(id)) throw new AppError("E_BUSY", "备份正在删除");
    const path = this.path(id);
    this.readers.set(id, (this.readers.get(id) ?? 0) + 1);
    try {
      yield* archiveBackup(path);
    } finally {
      const remaining = this.readers.get(id)! - 1;
      if (remaining) this.readers.set(id, remaining);
      else this.readers.delete(id);
    }
  }
  async create(): Promise<BackupRow> {
    if (this.busy) throw new AppError("E_BUSY", "备份正在运行");
    this.busy = true;
    let done!: () => void;
    this.completion = new Promise<void>((resolve) => {
      done = resolve;
    });
    let temp: string | undefined;
    try {
      await mkdir(this.directory, { recursive: true });
      temp = await mkdtemp(join(this.directory, ".snapshot-"));
      const snapshotDir = temp;
      await mkdir(join(snapshotDir, "objects"));
      const snapshotPath = join(snapshotDir, "talos.db");
      const manifest = await open(join(snapshotDir, "backup.ndjson"), "wx");
      let size = Buffer.byteLength(BACKUP_MAGIC) + 4;
      const record = async (entry: BackupEntry) => {
        const line = entryLine(entry);
        await manifest.writeFile(line);
        size += line.length + entry.size + 1;
      };
      try {
        await this.ledger.snapshot(async () => {
          await this.snapshots.capture(snapshotPath);
          const snapshot = new BackupSnapshot(snapshotPath);
          try {
            for (const item of snapshot.objects()) {
              const object = item as { id: string; size: number };
              const path = `objects/${object.id}`;
              const info = await copyChecked(
                this.store.read(object.id),
                join(snapshotDir, path),
                { size: object.size, sha256: object.id },
              );
              await record({ path, ...info });
            }
          } finally {
            snapshot.close();
          }
          await record({ path: "talos.db", ...(await hashFile(snapshotPath)) });
        });
        await manifest.sync();
      } finally {
        await manifest.close();
      }
      const row = { id: this.id(), created: this.now(), size };
      await rename(snapshotDir, join(this.directory, row.id + ".backup"));
      temp = undefined;
      this.repo.addBackup(row);
      for (const old of this.repo
        .backups()
        .slice(this.repo.settings().retention))
        if (!this.readers.has(old.id)) await this.delete(old.id);
      return row;
    } finally {
      this.busy = false;
      done();
      if (temp) await rm(temp, { recursive: true, force: true });
    }
  }
  async delete(id: string): Promise<void> {
    if (this.readers.has(id) || this.deleting.has(id))
      throw new AppError("E_BUSY", "备份正在使用");
    const path = this.path(id);
    this.deleting.add(id);
    try {
      await rm(path, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 20,
      });
      this.repo.deleteBackupDownloads(id);
      this.repo.deleteBackup(id);
    } finally {
      this.deleting.delete(id);
    }
  }
}
export async function restoreBackup(
  archive: string,
  dataDir: string,
): Promise<void> {
  const root = resolve(dataDir);
  const unlock = await acquireLock(dataLayout(root).lock, true);
  let temp: string | undefined;
  let reader: BackupReader | undefined;
  try {
    temp = await mkdtemp(join(root, ".restore-"));
    await mkdir(join(temp, "objects"));
    reader = new BackupReader(
      (await stat(archive)).isDirectory()
        ? archiveBackup(archive)
        : fileBytes(archive),
    );
    if ((await reader.line()) !== BACKUP_MAGIC.trimEnd())
      throw new AppError("E_INVALID", "备份格式无效");
    // Disk names and wx enforce uniqueness without a set growing with object count.
    for (;;) {
      const line = await reader.line();
      if (line === "END") break;
      if (line === undefined)
        throw new AppError("E_INTEGRITY", "备份内容不完整");
      const entry = parseEntry(line);
      try {
        await copyChecked(
          reader.bytes(entry.size),
          join(temp, entry.path),
          entry,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new AppError("E_INVALID", "备份文件重复");
        throw error;
      }
      if ((await reader.line()) !== "")
        throw new AppError("E_INTEGRITY", "备份分隔符无效");
    }
    if ((await reader.line()) !== undefined)
      throw new AppError("E_INVALID", "备份尾部无效");
    const testPath = join(temp, "talos.db");
    try {
      await stat(testPath);
    } catch (error) {
      throw AppError.wrap("E_INVALID", "备份缺少数据库", error);
    }
    let db: BackupSnapshot | undefined;
    try {
      db = new BackupSnapshot(testPath);
      db.validate();
      for (const item of db.objects()) {
        const object = item as { id: string; size: number };
        // Do not trust a database-provided path, even after validating SQLite itself.
        if (!/^[a-f0-9]{64}$/.test(object.id))
          throw new AppError("E_INTEGRITY", "备份对象编号无效");
        const path = join(temp, "objects", object.id);
        let info;
        try {
          info = await stat(path);
        } catch {
          throw new AppError("E_INTEGRITY", "备份对象不完整");
        }
        if (info.size !== object.size)
          throw new AppError("E_INTEGRITY", "备份对象不完整");
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw AppError.wrap("E_INTEGRITY", "备份数据库损坏", error);
    } finally {
      db?.close();
    }
    // Validation completes before any publication. Immutable objects first keeps old DB usable.
    const store = createFsObjectStore({ root });
    const snapshot = new BackupSnapshot(testPath);
    try {
      for (const item of snapshot.objects()) {
        const object = item as { id: string; size: number };
        await store.put(fileBytes(join(temp, "objects", object.id)), object);
      }
    } finally {
      snapshot.close();
    }
    const target = join(root, "talos.db");
    try {
      await stat(target);
      const old = new Db(target);
      old.close();
      const previous = join(temp, "before-restore.db");
      await copyFile(target, previous);
      await rename(previous, join(root, "before-restore.db"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rm(target + "-wal", { force: true });
    await rm(target + "-shm", { force: true });
    await rename(testPath, target);
  } finally {
    await reader?.close();
    if (temp) await rm(temp, { recursive: true, force: true });
    await unlock();
  }
}
