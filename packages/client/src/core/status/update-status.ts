import type { InstallerState } from "@talos/shell";
import type { StatusViewModel } from "./model.ts";
/** Translate mechanism state at the application boundary; the sheet remains presentational. */
export function toUpdateStatus(
  state: InstallerState,
  runningBuild: string,
  apply: () => void,
): StatusViewModel["update"] {
  switch (state.kind) {
    case "none":
      return { state: "none" };
    case "installing":
      return {
        state: "installing",
        progress:
          state.progress.totalBytes > 0
            ? state.progress.bytes / state.progress.totalBytes
            : state.progress.completed / Math.max(1, state.progress.total),
      };
    case "ready":
      return state.build === runningBuild
        ? { state: "none", message: "离线内容已就绪" }
        : { state: "ready", message: `版本 ${state.build} 已保存`, apply };
    case "applying":
      return { state: "applying" };
    case "failed":
      return { state: "failed", message: state.error.message };
  }
}
