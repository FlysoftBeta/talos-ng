import { AppError } from "@talos/base";
import { execFile } from "node:child_process";
export interface HostTools {
  readonly available: boolean;
  run(action: "kill-wps" | "shutdown"): Promise<void>;
}
export type RunCommand = (
  file: string,
  args: readonly string[],
) => Promise<string>;
export const runCommand: RunCommand = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        windowsHide: true,
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout) =>
        error
          ? reject(new AppError("E_UNAVAILABLE", "主机命令执行失败"))
          : resolve(stdout),
    );
  });
export function createHostTools(
  platform: NodeJS.Platform = process.platform,
  run: RunCommand = runCommand,
): HostTools {
  return {
    available: platform === "win32",
    async run(action) {
      if (platform !== "win32")
        throw new AppError("E_UNAVAILABLE", "此主机工具仅支持 Windows");
      if (action === "kill-wps")
        await run("taskkill.exe", [
          "/f",
          "/im",
          "et.exe",
          "/im",
          "wpp.exe",
          "/im",
          "wps.exe",
          "/im",
          "pdf.exe",
        ]);
      else await run("shutdown.exe", ["/s", "/t", "10"]);
    },
  };
}
