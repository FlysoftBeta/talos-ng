import { mkdir, readFile, rename, rm, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { AppError } from "@talos/base";
import { retry } from "../filesystem/retry-busy.ts";
import type { LauncherState } from "../process/supervisor.ts";
import { atomicFile } from "./atomic-file.ts";
import { buildId, verifyRelease } from "./manifest.ts";
import { installedTarget, assertTarget } from "./target.ts";

export class ReleaseFiles {
  constructor(readonly root: string) {}
  async read(): Promise<LauncherState> {
    // State is the atomic commit record; current is a repairable human-readable pointer.
    try {
      const state = JSON.parse(
        await readFile(join(this.root, "launcher-state.json"), "utf8"),
      ) as LauncherState;
      buildId(state.current);
      if (state.pending) {
        buildId(state.pending.previous);
        buildId(state.pending.build);
        if (!Number.isSafeInteger(state.pending.deadline))
          throw new Error("Invalid deadline");
      }
      await atomicFile(join(this.root, "current"), state.current + "\n");
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        current: buildId(
          (await readFile(join(this.root, "current"), "utf8")).trim(),
        ),
      };
    }
  }
  async save(state: LauncherState): Promise<void> {
    await atomicFile(
      join(this.root, "launcher-state.json"),
      JSON.stringify(state),
    );
    await atomicFile(join(this.root, "current"), state.current + "\n");
  }
  async stage(bytes: Uint8Array, expected: string): Promise<string> {
    const { manifest, files } = verifyRelease(bytes, expected);
    assertTarget(manifest.platform, installedTarget(this.root));
    const dest = join(this.root, "releases", manifest.build),
      temp = dest + ".staging";
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
      await retry(() => rename(temp, dest));
    } catch (error) {
      await rm(temp, { force: true, recursive: true });
      throw error;
    }
    return manifest.build;
  }
}
