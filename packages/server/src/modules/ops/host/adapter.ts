import { AppError } from "@talos/base";
import { execFile } from "node:child_process";
export type HostAction =
  | { action: "reset-classroom" }
  | { action: "shutdown"; delayMinutes: number }
  | { action: "cancel-shutdown" };
export interface HostTools {
  readonly available: boolean;
  /** When a shutdown this server scheduled will happen, if one is pending. */
  shutdownAt(): number | null;
  run(command: HostAction): Promise<void>;
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
/** Process names (without .exe) the classroom reset ends: Office, WPS, Seewo EasiNote and the visualiser. */
export const CLASSROOM_PROCESSES = [
  ...["WINWORD", "POWERPNT", "EXCEL"],
  ...["wps", "wpp", "et", "wpspdf", "pdf", "wpsoffice"],
  ...["EasiNote", "swenlauncher", "EasiCamera", "sweclauncher"],
] as const;
/**
 * Windows PowerShell 2.0+. Closes folder windows through the shell's window
 * list; the desktop and taskbar belong to the explorer process, which stays.
 * Missing processes are not an error.
 */
const resetScript = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
try {
 $shell = New-Object -ComObject Shell.Application
 foreach ($window in @($shell.Windows())) {
  try { if ([IO.Path]::GetFileName([string]$window.FullName) -ieq 'explorer.exe') { $window.Quit() } } catch {}
 }
} catch {}
Stop-Process -Force -Name ${CLASSROOM_PROCESSES.map((name) => `'${name}'`).join(",")}
exit 0
`;
/** Grace before an immediate shutdown; Windows shows its own notice meanwhile. */
const IMMEDIATE_SECONDS = 10;
export function createHostTools(
  platform: NodeJS.Platform = process.platform,
  run: RunCommand = runCommand,
  now: () => number = Date.now,
): HostTools {
  let pending: number | null = null;
  const abort = () =>
    // Fails when nothing is scheduled, which is the state wanted.
    run("shutdown.exe", ["/a"]).catch(() => "");
  return {
    available: platform === "win32",
    shutdownAt: () => (pending !== null && pending > now() ? pending : null),
    async run(command) {
      if (platform !== "win32")
        throw new AppError("E_UNAVAILABLE", "此主机工具仅支持 Windows");
      if (command.action === "reset-classroom") {
        await run("powershell.exe", [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          Buffer.from(resetScript, "utf16le").toString("base64"),
        ]);
      } else if (command.action === "cancel-shutdown") {
        await abort();
        pending = null;
      } else {
        const seconds = Math.max(
          IMMEDIATE_SECONDS,
          Math.floor(command.delayMinutes) * 60,
        );
        // Windows refuses a second schedule; the new one replaces the old.
        await abort();
        await run("shutdown.exe", ["/s", "/t", String(seconds)]);
        pending = now() + seconds * 1000;
      }
    },
  };
}
