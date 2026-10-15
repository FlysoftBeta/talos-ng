import { AppError } from "@talos/base";
import type { FileEnvironment } from "../../core/files/environment.ts";
export const browserFiles: FileEnvironment = {
  downloadUrl: (url) => {
    const target = new URL(url, window.location.href);
    if (
      target.origin !== window.location.origin ||
      !target.pathname.startsWith("/dl/")
    )
      throw new AppError("E_INVALID", "下载地址无效");
    return target.href;
  },
  fetch: (url, options) => window.fetch(url, options),
  get estimate() {
    return typeof navigator !== "undefined" && navigator.storage?.estimate
      ? () => navigator.storage.estimate()
      : undefined;
  },
};
