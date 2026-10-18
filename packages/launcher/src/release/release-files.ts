import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { AppError } from "@talos/base";
import { retry } from "../filesystem/retry-busy.ts";
import type { LauncherState } from "../process/supervisor.ts";
import { atomicFile } from "./atomic-file.ts";
import { buildId, verifyRelease } from "./manifest.ts";
import { assertTarget } from "./target.ts";
import type { PackageTarget } from "./target.ts";

/**
 * `versions/` holds one directory per installed version beside the launcher's
 * state; a version is unpacked under the tmp directory and moved in whole.
 */
export class ReleaseFiles {
  constructor(
    readonly versionsDir: string,
    private readonly tmpDir: string,
    private readonly target: PackageTarget,
  ) {}
  version(build: string): string {
    return join(this.versionsDir, buildId(build));
  }
  async read(): Promise<LauncherState> {
    // State is the atomic commit record; current is a repairable human-readable pointer.
    try {
      const state = JSON.parse(
        await readFile(join(this.versionsDir, "state.json"), "utf8"),
      ) as LauncherState;
      buildId(state.current);
      if (state.pending) {
        buildId(state.pending.previous);
        buildId(state.pending.build);
        if (!Number.isSafeInteger(state.pending.deadline))
          throw new Error("Invalid deadline");
      }
      await atomicFile(join(this.versionsDir, "current"), state.current + "\n");
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        current: buildId(
          (await readFile(join(this.versionsDir, "current"), "utf8")).trim(),
        ),
      };
    }
  }
  async save(state: LauncherState): Promise<void> {
    await atomicFile(
      join(this.versionsDir, "state.json"),
      JSON.stringify(state),
    );
    await atomicFile(join(this.versionsDir, "current"), state.current + "\n");
  }
  async stage(bytes: Uint8Array, expected: string): Promise<string> {
    const { manifest, files } = verifyRelease(bytes, expected);
    assertTarget(manifest.platform, this.target);
    const dest = this.version(manifest.build),
      temp = join(this.tmpDir, "versions", manifest.build);
    try {
      await stat(dest);
      throw new AppError("E_CONFLICT", "版本目录已存在");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rm(temp, { force: true, recursive: true });
    await mkdir(temp, { recursive: true });
    try {
      for (const [name, data] of files) {
        const path = join(temp, name);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, data);
      }
      // Only native helper binaries need execute permission on Linux.
      if (process.platform !== "win32") {
        const { chmod } = await import("node:fs/promises");
        for (const name of files.keys())
          if (name.endsWith("/pdfrender") || name.endsWith("/yt-dlp"))
            await chmod(join(temp, name), 0o755);
      }
      await this.moveIn(temp, dest);
    } finally {
      await rm(temp, { force: true, recursive: true });
    }
    return manifest.build;
  }
  /** Renames a finished version in; a tmp directory on another volume is copied beside first. */
  private async moveIn(temp: string, dest: string): Promise<void> {
    await mkdir(this.versionsDir, { recursive: true });
    try {
      await retry(() => rename(temp, dest));
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    }
    const near = dest + ".incoming";
    await rm(near, { force: true, recursive: true });
    try {
      await cp(temp, near, { recursive: true });
      await retry(() => rename(near, dest));
    } finally {
      await rm(near, { force: true, recursive: true });
    }
  }
  /** Removes every version directory except `keep` (and leftovers of interrupted moves). */
  async prune(keep: readonly string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(this.versionsDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries)
      if (entry.isDirectory() && !keep.includes(entry.name))
        await retry(() =>
          rm(join(this.versionsDir, entry.name), {
            force: true,
            recursive: true,
          }),
        );
  }
}
