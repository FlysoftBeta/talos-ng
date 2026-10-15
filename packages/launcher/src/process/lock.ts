import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "@talos/base";
import { retry } from "../filesystem/retry-busy.ts";

export async function acquireLock(
  root: string,
  reclaimDead = false,
): Promise<() => Promise<void>> {
  await mkdir(root, { recursive: true });
  const path = join(root, "launcher.lock");
  if (reclaimDead) {
    try {
      const pid = Number(await readFile(path, "utf8"));
      if (!Number.isSafeInteger(pid) || pid < 1)
        throw new AppError("E_BUSY", "锁文件损坏，请人工检查");
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") await rm(path);
        else throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  try {
    const f = await open(path, "wx");
    await f.writeFile(String(process.pid));
    await f.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new AppError(
        "E_BUSY",
        "启动器已运行，或存在未清理的锁；确认进程已退出后删除 launcher.lock",
      );
    throw error;
  }
  return () => retry(() => rm(path, { force: true }));
}
