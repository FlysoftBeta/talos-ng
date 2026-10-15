import { existsSync, readFileSync, realpathSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { digest } from "@talos/launcher";

/**
 * Native addons for one release target. They cannot be bundled by esbuild, so the
 * artifact gets a minimal `node_modules/` with exactly the target platform's files:
 *  - better-sqlite3 (N-API, so independent of the bundled Node ABI): `lib/` and the one
 *    `prebuilds/<platform>.node`;
 *  - sharp and its pure-JS dependencies plus `@img/sharp-<platform>` (and, on Linux,
 *    `@img/sharp-libvips-<platform>`).
 * Sources are the pnpm-installed packages (pnpm-workspace.yaml `supportedArchitectures`
 * installs the win32 ones on Linux hosts), whose tarball integrity the lockfile pins and
 * pnpm verifies; `native-manifest.json` additionally pins SHA-256 of the binaries.
 */
export type NativePlatform = "linux-x64" | "win32-x64";

const root = join(import.meta.dirname, "../..");
const manifestPath = join(import.meta.dirname, "native-manifest.json");
const serverModules = join(root, "packages/server/node_modules");

/** `@img/sharp-linux-x64` -> `linux-x64`; undefined for other packages. */
function sharpPlatform(name: string): string | undefined {
  return /^@img\/sharp-(?:libvips-)?((?:linux|linuxmusl|darwin|win32|freebsd)-.+|webcontainers-.+)$/.exec(
    name,
  )?.[1];
}

async function listFiles(dir: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const item of (await readdir(dir, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (item.isSymbolicLink())
      throw new Error("Native packages cannot contain symbolic links");
    const path = `${prefix}${item.name}`;
    if (item.isDirectory())
      result.push(...(await listFiles(join(dir, item.name), path + "/")));
    else result.push(path);
  }
  return result;
}

interface Package {
  name: string;
  dir: string;
  deps: string[];
}
function readPackage(name: string, dir: string): Package {
  const json = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  return {
    name,
    dir,
    deps: [
      ...Object.keys(json.dependencies ?? {}),
      ...Object.keys(json.optionalDependencies ?? {}),
    ],
  };
}
/** pnpm keeps a package's dependencies as siblings of its real directory. */
function sibling(from: Package, name: string): string | undefined {
  const modules = from.name.startsWith("@")
    ? dirname(dirname(from.dir))
    : dirname(from.dir);
  const path = join(modules, name);
  return existsSync(path) ? realpathSync(path) : undefined;
}

async function assemble(
  platform: NativePlatform,
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();

  const sqlite = realpathSync(join(serverModules, "better-sqlite3"));
  files.set(
    "node_modules/better-sqlite3/package.json",
    await readFile(join(sqlite, "package.json")),
  );
  for (const file of await listFiles(join(sqlite, "lib")))
    // Per-platform entry shims (`win32-x64.js`...) are never used by the default entry.
    if (!/^(?:linux|linuxmusl|darwin|win32)-[a-z0-9]+\.js$/.test(file))
      files.set(
        `node_modules/better-sqlite3/lib/${file}`,
        await readFile(join(sqlite, "lib", file)),
      );
  files.set(
    `node_modules/better-sqlite3/prebuilds/${platform}.node`,
    await readFile(join(sqlite, "prebuilds", `${platform}.node`)),
  );

  const sharp = realpathSync(join(serverModules, "sharp"));
  const seen = new Set<string>();
  const queue: Package[] = [readPackage("sharp", sharp)];
  while (queue.length) {
    const current = queue.pop()!;
    if (seen.has(current.name)) continue;
    seen.add(current.name);
    const only = current.name === "sharp";
    for (const file of await listFiles(current.dir))
      if (
        !only ||
        file === "package.json" ||
        file === "LICENSE" ||
        file.startsWith("dist/")
      )
        files.set(
          `node_modules/${current.name}/${file}`,
          await readFile(join(current.dir, file)),
        );
    for (const dep of current.deps) {
      const wanted = sharpPlatform(dep);
      if (wanted !== undefined && wanted !== platform) continue;
      const dir = sibling(current, dep);
      if (!dir) {
        if (wanted === undefined) continue; // optional JS dependency absent
        throw new Error(
          `Missing ${dep}; run pnpm install (supportedArchitectures must cover ${platform})`,
        );
      }
      queue.push(readPackage(dep, dir));
    }
  }
  // sharp's libvips package is a dependency of the platform package on Linux only.
  for (const name of [`@img/sharp-${platform}`])
    if (!seen.has(name)) throw new Error(`${name} missing from sharp closure`);

  for (const path of files.keys()) {
    const foreign =
      /(?:^|[/-])(linuxmusl|darwin|freebsd|webcontainers|linux-(?:arm|arm64|ppc64|riscv64|s390x)|win32-(?:ia32|arm64)|win32-x64|linux-x64)(?:[/.-]|$)/.exec(
        path,
      )?.[1];
    if (
      foreign &&
      foreign !== platform &&
      !/^node_modules\/(?:@img\/colour|semver|detect-libc)\//.test(path)
    )
      throw new Error(`Foreign native file in ${platform} artifact: ${path}`);
  }

  return files;
}

const isBinary = (path: string): boolean =>
  /\.(?:node|dll|so(?:\.\d+)*)$/.test(path);

export async function nativeFiles(
  platform: NativePlatform,
): Promise<Map<string, Uint8Array>> {
  const files = await assemble(platform);
  const pins = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
    string,
    Record<string, string>
  >;
  const pinned = pins[platform] ?? {};
  for (const [path, bytes] of files)
    if (isBinary(path) && pinned[path] !== digest(bytes))
      throw new Error(
        `Native binary ${path} does not match tools/package/native-manifest.json (got ${digest(bytes)}); review the dependency bump, then run: node --experimental-transform-types tools/package/native.ts --pin`,
      );
  for (const path of Object.keys(pinned))
    if (!files.has(path))
      throw new Error(`Pinned native binary missing: ${path}`);
  return files;
}

if (process.argv[1] === import.meta.filename && process.argv[2] === "--pin") {
  const pins: Record<string, Record<string, string>> = {};
  for (const platform of ["linux-x64", "win32-x64"] as const) {
    pins[platform] = {};
    for (const [path, bytes] of await assemble(platform))
      if (isBinary(path)) pins[platform][path] = digest(bytes);
  }
  await writeFile(manifestPath, JSON.stringify(pins, null, 2) + "\n");
}
