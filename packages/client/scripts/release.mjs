import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
/** Verify the bytes consumers will install, including classic-script ordering. */
export async function verifyRelease(directory) {
  const manifest = JSON.parse(
    await readFile(path.join(directory, "app", "manifest.json"), "utf8"),
  );
  const paths = new Set();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(manifest.build) ||
    !Array.isArray(manifest.assets)
  )
    throw new Error("Invalid release manifest");
  for (const asset of manifest.assets) {
    if (
      typeof asset.path !== "string" ||
      !asset.path.startsWith(`/app/${manifest.build}/`) ||
      asset.path.split("/").includes("..") ||
      asset.path.includes("\\") ||
      paths.has(asset.path) ||
      asset.path.includes("gallery")
    )
      throw new Error("Invalid release asset path");
    paths.add(asset.path);
    const bytes = await readFile(path.join(directory, asset.path.slice(1)));
    if (
      bytes.length !== asset.size ||
      createHash("sha256").update(bytes).digest("hex") !== asset.sha256
    )
      throw new Error("Release asset integrity mismatch");
  }
  // Gallery files are development-only and are excluded by the packager.
  async function inventory(dir, prefix) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const relative = `${prefix}/${entry.name}`;
      if (entry.isDirectory())
        await inventory(path.join(dir, entry.name), relative);
      else if (!entry.name.startsWith("gallery-") && !paths.has(relative))
        throw new Error(`Release asset missing from manifest: ${relative}`);
    }
  }
  await inventory(
    path.join(directory, "app", manifest.build),
    `/app/${manifest.build}`,
  );
  const shellPath = `/app/${manifest.build}/index.html`;
  if (!paths.has(shellPath)) throw new Error("Release shell missing");
  const shell = await readFile(
    path.join(directory, shellPath.slice(1)),
    "utf8",
  );
  if (shell !== (await readFile(path.join(directory, "index.html"), "utf8")))
    throw new Error("Shell copies differ");
  const scripts = Array.from(
    shell.matchAll(/<script defer src="([^"]+)"/g),
    (match) => match[1],
  );
  if (
    scripts.length !== 2 ||
    !scripts[0].includes("/polyfills-") ||
    !scripts[1].includes("/main-") ||
    scripts.some((src) => !paths.has(src))
  )
    throw new Error("Polyfills must precede the application");
  if (/https?:\/\/|type="module"|importmap/.test(shell))
    throw new Error("Release shell must use local classic scripts");
  return manifest;
}
