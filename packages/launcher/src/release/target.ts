import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppError } from "@talos/base";
import type { ReleaseManifest } from "./manifest.ts";
export type PackageTarget = ReleaseManifest["platform"];
export const packageTargets: readonly PackageTarget[] = [
  "win32-x64",
  "linux-debian-x64",
  "linux-redhat-x64",
];
export function parseTarget(value: string): PackageTarget {
  if (!packageTargets.includes(value as PackageTarget))
    throw new AppError("E_INVALID", `Unknown package target: ${value}`);
  return value as PackageTarget;
}
export function hostTarget(): PackageTarget {
  if (process.arch !== "x64")
    throw new AppError("E_UNAVAILABLE", "Only x64 is supported");
  if (process.platform === "win32") return "win32-x64";
  if (process.platform !== "linux")
    throw new AppError("E_UNAVAILABLE", "Unsupported platform");
  const os = readFileSync("/etc/os-release", "utf8");
  return /^(?:ID|ID_LIKE)=.*(?:fedora|rhel|centos|redhat|rocky|almalinux)/m.test(
    os,
  )
    ? "linux-redhat-x64"
    : "linux-debian-x64";
}
/** The install's immutable target, `runtime/target` under the install root. */
export function installedTarget(root?: string): PackageTarget {
  return root
    ? parseTarget(readFileSync(join(root, "runtime", "target"), "utf8").trim())
    : hostTarget();
}
export function assertTarget(actual: string, expected: PackageTarget): void {
  if (actual !== expected)
    throw new AppError(
      "E_INVALID",
      `更新包目标不匹配 / Update target mismatch: expected ${expected}, received ${actual}`,
    );
}
