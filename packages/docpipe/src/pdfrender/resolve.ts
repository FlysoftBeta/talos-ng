import { spawn, execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@talos/base";

export type PdfRenderFlavor =
  "override" | "linux-debian" | "linux-redhat" | "win32-x64";
export interface PdfRenderLocation {
  executable: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  flavor?: PdfRenderFlavor;
  target?: string;
}
export interface FlavorDiagnosis {
  flavor: PdfRenderFlavor;
  executable: string;
  ok: boolean;
  detail: string;
}
export interface PdfRenderDiagnosis {
  selected: PdfRenderLocation;
  flavors: FlavorDiagnosis[];
}
export type PdfRenderProbe = (
  executable: string,
  env: NodeJS.ProcessEnv,
) => Promise<{ ok: boolean; detail: string }>;
export interface ResolvePdfRenderOptions {
  vendorDir: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  override?: string;
  /** Development distro identification; packaged target file takes precedence. */
  osRelease?: string;
  probe?: PdfRenderProbe;
}

/** Runs --help with a bounded output buffer and a short startup deadline. */
export const probePdfRender: PdfRenderProbe = (executable, env) =>
  new Promise((resolve) => {
    const child = spawn(executable, ["--help"], {
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let error: Error | undefined;
    let timedOut = false;
    const append = (chunk: Buffer): void => {
      output = (output + chunk.toString("utf8")).slice(-8192);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", (value) => {
      error = value;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 2000);
    child.once("close", (code) => {
      clearTimeout(timer);
      const missing = output.match(
        /([\w.+-]+\.so(?:\.\d+)*)\s*:\s*cannot open shared object file/i,
      )?.[1];
      const detail = timedOut
        ? "startup timed out"
        : missing
          ? `missing ${missing}`
          : (error?.message ??
            (code === 0
              ? "--help succeeded"
              : output.trim() || `exit ${code}`));
      resolve({ ok: !timedOut && !error && code === 0, detail });
    });
  });

export function createPdfRenderResolver(): {
  diagnose(options: ResolvePdfRenderOptions): Promise<PdfRenderDiagnosis>;
  resolve(options: ResolvePdfRenderOptions): Promise<PdfRenderLocation>;
} {
  const cache = new Map<string, Promise<PdfRenderDiagnosis>>();
  const diagnose = (
    options: ResolvePdfRenderOptions,
  ): Promise<PdfRenderDiagnosis> => {
    const platform = options.platform ?? process.platform;
    if (platform !== "linux" && platform !== "win32")
      return Promise.reject(
        new AppError(
          "E_UNAVAILABLE",
          `pdfrender is unsupported on ${platform}`,
        ),
      );
    const env = { ...(options.env ?? process.env) };
    const override = options.override;
    const vendorDir = path.resolve(options.vendorDir);
    const key = JSON.stringify([
      platform,
      vendorDir,
      override ?? null,
      env,
      options.osRelease,
    ]);
    const existing = cache.get(key);
    if (existing) return existing;
    const result = (async (): Promise<PdfRenderDiagnosis> => {
      let target: string;
      try {
        target = (
          await readFile(path.join(vendorDir, "target"), "utf8")
        ).trim();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const os =
          platform === "linux"
            ? (options.osRelease ?? (await readFile("/etc/os-release", "utf8")))
            : "";
        target =
          platform === "win32"
            ? "win32-x64"
            : /^(?:ID|ID_LIKE)=.*(?:fedora|rhel|centos|redhat|rocky|almalinux)/m.test(
                  os,
                )
              ? "linux-redhat-x64"
              : "linux-debian-x64";
      }
      if (
        !["win32-x64", "linux-debian-x64", "linux-redhat-x64"].includes(
          target,
        ) ||
        (platform === "win32") !== (target === "win32-x64")
      )
        throw new AppError(
          "E_UNAVAILABLE",
          `Invalid pdfrender target ${target} on ${platform}`,
        );
      const flavor: PdfRenderFlavor = override
        ? "override"
        : target === "win32-x64"
          ? target
          : target === "linux-redhat-x64"
            ? "linux-redhat"
            : "linux-debian";
      const executable = path.resolve(
        override ??
          path.join(
            vendorDir,
            flavor === "win32-x64" ? "windows" : flavor,
            platform === "win32" ? "pdfrender.exe" : "pdfrender",
          ),
      );
      const childEnv = { ...env };
      if (platform === "linux")
        childEnv.LD_LIBRARY_PATH = [
          path.dirname(executable),
          env.LD_LIBRARY_PATH,
        ]
          .filter(Boolean)
          .join(path.delimiter);
      const probe = await (options.probe ?? probePdfRender)(
        executable,
        childEnv,
      );
      if (!probe.ok && platform === "linux") {
        const missing = await new Promise<string[]>((resolve) => {
          execFile(
            "ldd",
            [executable],
            { env: childEnv, timeout: 2000, maxBuffer: 65536 },
            (_error, stdout) =>
              resolve(
                [...stdout.matchAll(/^\s*(\S+) => not found/gm)].map(
                  (m) => m[1]!,
                ),
              ),
          );
        });
        if (missing.length)
          probe.detail = `missing shared libraries: ${missing.join(", ")}; ${probe.detail}`;
      }
      const chosen = { flavor, executable, ...probe };
      if (!probe.ok)
        throw new AppError(
          "E_UNAVAILABLE",
          `pdfrender ${target} (${executable}): ${probe.detail}. Install the matching distribution libraries listed in vendor/pdfrender/README.md.`,
          { target, executable, flavors: [chosen] },
        );
      const selectedEnv = { ...env };
      if (platform === "linux")
        selectedEnv.LD_LIBRARY_PATH = [
          path.dirname(chosen.executable),
          env.LD_LIBRARY_PATH,
        ]
          .filter(Boolean)
          .join(path.delimiter);
      return {
        selected: {
          executable: chosen.executable,
          env: selectedEnv,
          platform,
          flavor: chosen.flavor,
          target,
        },
        flavors: [chosen],
      };
    })();
    cache.set(key, result);
    return result;
  };
  return {
    diagnose,
    resolve: async (options) => (await diagnose(options)).selected,
  };
}
const defaultResolver = createPdfRenderResolver();
export const diagnosePdfRender = defaultResolver.diagnose;
export const resolvePdfRender = defaultResolver.resolve;
