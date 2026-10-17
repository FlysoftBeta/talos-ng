import { AppError } from "@talos/base";
import type { contract, ResultOf } from "@talos/contract";
import {
  assertTarget,
  atomicFile,
  digest,
  installedTarget,
  MAX_ARCHIVE,
  verifyRelease,
} from "@talos/launcher";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Backups } from "../backup/service.ts";
import { copyChecked } from "../backup/stream.ts";
import type { OpsRepo } from "../repo.ts";
export interface UpdateBridge {
  apply(message: { archive: string; sha256: string; backup: string }): void;
  confirm(): void;
  pending: boolean;
  /** The launcher's install directory, whose `target` file names the platform; none means the host's. */
  root?: string;
}
interface CloudManifest {
  v: 1;
  build: string;
  url: string;
  size: number;
  sha256: string;
}
export type FetchBytes = (url: string, limit: number) => Promise<Uint8Array>;
const MAX_REDIRECTS = 5;
export const defaultManifestUrl = (platform: string): string =>
  `https://github.com/FlysoftBeta/talos-ng/releases/latest/download/talos-${platform}-update.json`;
export const fetchBytes: FetchBytes = async (url, limit) => {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 120_000);
  try {
    let response: Response;
    for (let hops = 0; ; hops++) {
      if (!/^https:\/\//.test(url))
        throw new AppError("E_INVALID", "云端更新地址必须使用 HTTPS");
      response = await fetch(url, {
        signal: controller.signal,
        redirect: "manual",
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || hops >= MAX_REDIRECTS)
        throw new AppError("E_UNAVAILABLE", "更新地址重定向过多");
      url = new URL(location, url).href;
    }
    if (!response.ok || !response.body)
      throw new AppError("E_UNAVAILABLE", "下载失败");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
      total += part.length;
      if (total > limit) throw new AppError("E_TOO_LARGE", "下载内容过大");
      chunks.push(part);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("E_UNAVAILABLE", "无法连接更新服务器");
  } finally {
    clearTimeout(timer);
  }
};
export class Updates {
  private state: ResultOf<typeof contract.ops.update.status>;
  private staged?: { archive: string; sha256: string; backup: string };
  private latest?: CloudManifest;
  private lastCheck = 0;
  constructor(
    private readonly repo: Pick<OpsRepo, "settings">,
    private readonly backups: Pick<Backups, "create" | "download">,
    private readonly directory: string,
    build: string,
    private readonly now: () => number,
    private readonly bridge?: UpdateBridge,
    private readonly fetch: FetchBytes = fetchBytes,
  ) {
    this.state = {
      build,
      phase: bridge?.pending ? "pending" : "idle",
      candidate: null,
      progress: 0,
      lastError: null,
      launcher: !!bridge,
    };
  }
  status(): ResultOf<typeof contract.ops.update.status> {
    return { ...this.state };
  }
  private requireIdle(): void {
    if (!this.bridge)
      throw new AppError("E_UNAVAILABLE", "请通过启动器运行服务器");
    if (!["idle", "staged"].includes(this.state.phase))
      throw new AppError("E_BUSY", "另一更新操作正在运行");
  }
  async stage(
    bytes: Uint8Array,
  ): Promise<ResultOf<typeof contract.ops.update.status>> {
    this.requireIdle();
    this.state.phase = "staging";
    this.state.lastError = null;
    try {
      await this.prepare(bytes);
      return this.status();
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  private async prepare(bytes: Uint8Array, expected?: string): Promise<void> {
    const { manifest } = verifyRelease(bytes, expected);
    assertTarget(manifest.platform, installedTarget(this.bridge?.root));
    if (manifest.build === this.state.build)
      throw new AppError("E_CONFLICT", "此版本已安装");
    this.state.progress = 0.5;
    const backup = await this.backups.create();
    await mkdir(this.directory, { recursive: true });
    const archive = join(this.directory, "staged-update.zip");
    await atomicFile(archive, bytes);
    const rollback = join(this.directory, "rollback.talos-backup");
    const temporary = rollback + ".tmp";
    await rm(temporary, { force: true });
    try {
      await copyChecked(this.backups.download(backup.id), temporary);
      await rename(temporary, rollback);
    } finally {
      await rm(temporary, { force: true });
    }
    this.staged = { archive, sha256: digest(bytes), backup: rollback };
    // Staged is durable; applying is explicit, never implicit on server restart.
    await atomicFile(
      join(this.directory, "staged-update.json"),
      JSON.stringify(this.staged),
    );
    this.state = {
      ...this.state,
      phase: "staged",
      candidate: manifest.build,
      progress: 1,
    };
  }
  apply(): () => void {
    if (!this.bridge || !this.staged || this.state.phase !== "staged")
      throw new AppError("E_CONFLICT", "没有已准备的更新");
    const message = this.staged;
    this.state.phase = "pending";
    return () => this.bridge!.apply(message);
  }
  confirm(): void {
    if (!this.bridge) throw new AppError("E_UNAVAILABLE", "启动器不可用");
    this.bridge.confirm();
    this.state.phase = "idle";
  }
  async check(): Promise<ResultOf<typeof contract.ops.update.status>> {
    this.requireIdle();
    const settings = this.repo.settings();
    if (!settings.cloudEnabled)
      throw new AppError("E_UNAVAILABLE", "云端更新未开启");
    const manifestUrl =
      settings.manifestUrl ||
      defaultManifestUrl(installedTarget(this.bridge?.root));
    this.state.phase = "checking";
    try {
      this.latest = await this.fetchManifest(manifestUrl);
      this.state.candidate = this.latest.build;
      this.state.phase = "idle";
      this.state.lastError = null;
      this.lastCheck = this.now();
      return this.status();
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  private async fetchManifest(url: string): Promise<CloudManifest> {
    let m: CloudManifest;
    try {
      m = JSON.parse(
        Buffer.from(await this.fetch(url, 1024 * 1024)).toString(),
      ) as CloudManifest;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("E_INVALID", "更新清单无效");
    }
    if (
      !m ||
      m.v !== 1 ||
      typeof m.build !== "string" ||
      typeof m.url !== "string" ||
      !Number.isSafeInteger(m.size) ||
      m.size < 1 ||
      m.size > MAX_ARCHIVE ||
      !/^[a-f0-9]{64}$/.test(m.sha256)
    )
      throw new AppError("E_INVALID", "更新清单无效");
    m.url = new URL(m.url, url).href;
    if (!m.url.startsWith("https://"))
      throw new AppError("E_INVALID", "更新下载地址必须使用 HTTPS");
    return m;
  }
  async install(): Promise<ResultOf<typeof contract.ops.update.status>> {
    await this.check();
    const manifest = this.latest!;
    this.state.phase = "staging";
    try {
      const bytes = await this.fetch(manifest.url, manifest.size);
      if (bytes.length !== manifest.size)
        throw new AppError("E_INTEGRITY", "更新包长度不匹配");
      const verified = verifyRelease(bytes, manifest.sha256);
      if (verified.manifest.build !== manifest.build)
        throw new AppError("E_INTEGRITY", "更新清单版本不匹配");
      // Internal prepare owns no re-entrancy guard: avoids legacy cloudInstalling self-rejection.
      await this.prepare(bytes, manifest.sha256);
      return this.status();
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  async autoCheck(): Promise<void> {
    const config = this.repo.settings();
    if (
      config.autoCheck &&
      config.cloudEnabled &&
      this.state.phase === "idle" &&
      this.now() - this.lastCheck >= 900_000
    ) {
      this.lastCheck = this.now();
      await this.check();
    }
  }
  reject(message: string): void {
    this.fail(new AppError("E_UNAVAILABLE", message));
  }
  private fail(error: unknown): void {
    this.state.phase = "idle";
    this.state.progress = 0;
    this.state.lastError =
      error instanceof AppError ? error.message : "更新失败";
  }
  async stageFile(
    path: string,
  ): Promise<ResultOf<typeof contract.ops.update.status>> {
    return this.stage(await readFile(path));
  }
}
