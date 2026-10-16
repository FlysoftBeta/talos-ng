import { AppError } from "@talos/base";
import { mediaPlaylistSchema } from "@talos/contract";
import type { Database } from "@talos/store";
import type { SavedSession } from "../auth/session.ts";
import type { StatusViewModel } from "../status/model.ts";
import type { SyncEngine } from "../data/sync-engine.ts";
import type { FileEnvironment, FileStorage } from "./environment.ts";
import type { EvictionManager } from "./eviction.ts";
import { fetchFileRanges } from "./ranged-download.ts";

export interface FilesControllerPorts {
  files?: FileStorage;
  saved?: SavedSession;
  eviction?: EvictionManager;
  generation: number;
  environment: FileEnvironment;
  closed: boolean;
  db?: Database;
  hasScope(scope: string): boolean;
  engine?: SyncEngine;
  storageFull: boolean;
  status(patch: Partial<StatusViewModel>): void;
}

export class FilesController {
  constructor(private readonly ports: FilesControllerPorts) {}
  private sessionFence(key: string): { user: string; assertActive(): void } {
    const user = this.ports.saved?.user.id;
    if (!user) throw new AppError("E_UNAUTHENTICATED", "请先登录");
    const generation = this.ports.generation;
    const assertActive = (): void => {
      if (
        this.ports.closed ||
        this.ports.generation !== generation ||
        this.ports.saved?.user.id !== user
      )
        throw new AppError("E_CANCELLED", "旧会话请求已取消");
      this.assertLocalScope(key);
    };
    assertActive();
    return { user, assertActive };
  }
  async readFile(rid: string): Promise<Uint8Array | undefined> {
    if (!this.ports.files || !this.ports.saved) return undefined;
    const user = this.ports.saved.user.id;
    if (!(await this.ports.files.has(rid))) return undefined;
    if (
      !(await this.ports.files.owners(rid)).some((owner) =>
        owner.startsWith(`${user}:`),
      )
    )
      return undefined;
    this.ports.eviction?.touch(rid);
    const bytes = new Uint8Array(await this.ports.files.read(rid));
    return this.ports.saved?.user.id === user ? bytes : undefined;
  }
  async hasFile(rid: string): Promise<boolean> {
    if (!this.ports.files || !this.ports.saved) return false;
    const user = this.ports.saved.user.id;
    const complete = await this.ports.files.has(rid);
    const owned = (await this.ports.files.owners(rid)).some((owner) =>
      owner.startsWith(`${user}:`),
    );
    return complete && owned && this.ports.saved?.user.id === user;
  }
  async readFileRange(
    rid: string,
    start: number,
    end: number,
  ): Promise<Uint8Array | undefined> {
    const generation = this.ports.generation;
    if (!this.ports.files || !(await this.hasFile(rid))) return undefined;
    this.ports.eviction?.touch(rid);
    const bytes = new Uint8Array(
      await this.ports.files.read(rid, { start, end }),
    );
    return generation === this.ports.generation ? bytes : undefined;
  }
  async downloadFile(
    rid: string,
    size: number,
    url: string,
    owner: string,
    onProgress?: (written: number, total: number) => void,
  ): Promise<void> {
    if (!this.ports.files || !this.ports.saved)
      throw new AppError("E_UNAUTHENTICATED", "请先登录");
    const target = this.ports.environment.downloadUrl(url);
    const { user, assertActive } = this.sessionFence(owner);
    await this.ports.eviction?.makeRoom(size);
    assertActive();
    const writer = await this.ports.files.begin(rid, size);
    try {
      await fetchFileRanges({
        url: target,
        size,
        writer,
        fetch: this.ports.environment.fetch,
        assertActive,
        progress: onProgress,
      });
      await this.ports.files.retain(`${user}:${owner}`, rid);
      try {
        assertActive();
      } catch (error) {
        await this.ports.files.releaseOwner(`${user}:${owner}`);
        throw error;
      }
    } finally {
      await writer.close();
    }
  }
  async collectFiles(): Promise<void> {
    await this.ports.files?.gc({ incompleteOlderThanMs: 24 * 60 * 60 * 1000 });
  }
  async saveFile(rid: string, bytes: Uint8Array, owner: string): Promise<void> {
    if (!this.ports.files || !this.ports.saved)
      throw new AppError("E_UNAUTHENTICATED", "请先登录");
    const { user, assertActive } = this.sessionFence(owner);
    await this.ports.eviction?.makeRoom(bytes.length);
    assertActive();
    await this.ports.files.put(rid, bytes);
    assertActive();
    await this.ports.files.retain(`${user}:${owner}`, rid);
    try {
      assertActive();
    } catch (error) {
      await this.ports.files.releaseOwner(`${user}:${owner}`);
      throw error;
    }
  }
  async retainFile(rid: string, owner: string): Promise<void> {
    if (!this.ports.files || !this.ports.saved)
      throw new AppError("E_UNAUTHENTICATED", "请先登录");
    const { user, assertActive } = this.sessionFence(owner);
    await this.ports.files.retain(`${user}:${owner}`, rid);
    try {
      assertActive();
    } catch (error) {
      await this.ports.files.releaseOwner(`${user}:${owner}`);
      throw error;
    }
  }
  async releaseFiles(owner: string): Promise<void> {
    if (!this.ports.files || !this.ports.saved) return;
    await this.ports.files.releaseOwner(`${this.ports.saved.user.id}:${owner}`);
  }
  async getLocal<T>(key: string): Promise<T | undefined> {
    if (!this.ports.db || !this.ports.saved) return undefined;
    this.assertLocalScope(key);
    const user = this.ports.saved.user.id;
    this.ports.eviction?.touch(`feature:${user}:${key}`);
    const value = await this.ports.db
      .table<T, string>("kv")
      .get(`feature:${user}:${key}`);
    this.assertLocalScope(key);
    return this.ports.saved?.user.id === user ? value : undefined;
  }
  async setLocal<T>(key: string, value: T): Promise<void> {
    if (!this.ports.db || !this.ports.saved)
      throw new AppError("E_UNAUTHENTICATED", "请先登录");
    const { user, assertActive } = this.sessionFence(key);
    const storageKey = `feature:${user}:${key}`;
    await this.ports.eviction?.makeRoom(JSON.stringify(value)?.length * 2 || 0);
    assertActive();
    await this.ports.db.table<T, string>("kv").put(value, storageKey);
    try {
      assertActive();
      await this.ports.eviction?.track(storageKey, value);
      assertActive();
    } catch (error) {
      await this.ports.db.table("kv").delete(storageKey);
      throw error;
    }
  }
  assertLocalScope(key: string): void {
    const retained = /^(library|media):([^:]+):retained$/.exec(key);
    if (retained) {
      const type = retained[1] === "library" ? "libraryDoc" : "mediaTrack";
      const visible = this.ports.engine
        ?.getSnapshot()
        .rows.some(
          (row) =>
            row.type === type &&
            row.id === retained[2] &&
            !row.deleted &&
            this.ports.hasScope(row.scope),
        );
      if (!visible) throw new AppError("E_DENIED", "内容访问权限已失效");
    }
    const match = /^((?:conv|coll):[^:]+):/.exec(key);
    if (match && !this.ports.hasScope(match[1]!))
      throw new AppError("E_DENIED", "内容访问权限已失效");
    const media = /^(coll:[^:]+):media:([^:]+)$/.exec(key);
    if (media) {
      const row = this.ports.engine
        ?.getSnapshot()
        .rows.find(
          (row) =>
            row.scope === media[1] &&
            row.type === "mediaPlaylist" &&
            !row.deleted,
        );
      const parsed = mediaPlaylistSchema.safeParse(row?.data);
      if (!parsed.success || !parsed.data.tracks.includes(media[2]!))
        throw new AppError("E_DENIED", "曲目已从歌单移除");
    }
  }
  async estimateStorage(): Promise<void> {
    if (this.ports.storageFull) {
      this.ports.status({ storage: "存储空间不足" });
      return;
    }
    if (!this.ports.environment.estimate) {
      this.ports.status({ storage: "此浏览器不支持存储估算" });
      return;
    }
    try {
      const value = await this.ports.environment.estimate();
      this.ports.status({
        storage: `${((value.usage ?? 0) / 1048576).toFixed(1)} MB / ${((value.quota ?? 0) / 1048576).toFixed(0)} MB`,
      });
    } catch {
      this.ports.status({ storage: "暂时无法估算" });
    }
  }
}
