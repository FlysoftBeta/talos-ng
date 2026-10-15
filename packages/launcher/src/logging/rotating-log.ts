import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { retry } from "../filesystem/retry-busy.ts";

export class RotatingLog {
  private pending = Promise.resolve();
  constructor(
    private readonly path: string,
    private readonly limit = 2 * 1024 * 1024,
  ) {}
  write(data: string | Uint8Array): Promise<void> {
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        let size = 0;
        try {
          size = (await stat(this.path)).size;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if (size >= this.limit) {
          await retry(() => rm(this.path + ".1", { force: true }));
          await retry(() => rename(this.path, this.path + ".1"));
        }
        await appendFile(this.path, data);
      });
    return this.pending;
  }
  flush(): Promise<void> {
    return this.pending;
  }
}
