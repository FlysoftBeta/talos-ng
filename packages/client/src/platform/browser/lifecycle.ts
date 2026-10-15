import { AppError } from "@talos/base";
import type { Installer, ShellManifest } from "@talos/shell";
import type { RuntimeEnvironment } from "../../core/lifecycle/environment.ts";
import { createBoot } from "../transport/boot.ts";
import { installBackTrap } from "./back-trap.ts";
import { installDiagnostics } from "./diagnostics.ts";
import { browserFiles } from "./files.ts";
import { browserSession } from "./session.ts";
declare global {
  interface Window {
    __talosShell?: Installer;
  }
}
export function browserEnvironment(
  reload: () => void = () => location.reload(),
): RuntimeEnvironment {
  return {
    ...browserSession,
    ...browserFiles,
    available: () => typeof window !== "undefined",
    description: (device) =>
      `${navigator.userAgent} device/${device ?? "unknown"}`,
    diagnostics: installDiagnostics,
    backTrap: (lock) => installBackTrap(window, lock),
    network: (online, offline) => {
      window.addEventListener("online", online);
      window.addEventListener("offline", offline);
      return () => {
        window.removeEventListener("online", online);
        window.removeEventListener("offline", offline);
      };
    },
    resetChannel: (receive) => {
      if (typeof BroadcastChannel === "undefined") return undefined;
      const channel = new BroadcastChannel("talos-app-reset");
      channel.onmessage = (event: MessageEvent<unknown>) => receive(event.data);
      return channel;
    },
    reload,
    boot: (build, onState) => createBoot({ build, onState }),
    exposeInstaller: (installer) => {
      if (typeof window !== "undefined") {
        if (installer) window.__talosShell = installer;
        else delete window.__talosShell;
      }
    },
    manifest: async () => {
      const response = await fetch("/app/manifest.json", { cache: "no-store" });
      if (!response.ok) throw new AppError("E_OFFLINE", "暂时无法检查更新");
      return (await response.json()) as ShellManifest;
    },
  };
}
