// @vitest-environment node
import { it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { verifyRelease } from "./release.mjs";
let dir, manifest;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "talos-release-"));
  await mkdir(path.join(dir, "app", "test"), { recursive: true });
  const shell =
    '<script defer src="/app/test/polyfills-a.js"></script><script defer src="/app/test/main-b.js"></script>';
  manifest = { build: "test", assets: [] };
  for (const [file, text] of [
    ["index.html", shell],
    ["polyfills-a.js", "/* polyfills */"],
    ["main-b.js", "/* application */"],
  ]) {
    const bytes = Buffer.from(text);
    await writeFile(path.join(dir, "app", "test", file), bytes);
    manifest.assets.push({
      path: `/app/test/${file}`,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mime: "text/plain",
    });
  }
  await writeFile(path.join(dir, "index.html"), shell);
  await save();
});
afterEach(() => rm(dir, { recursive: true, force: true }));
const save = () =>
  writeFile(path.join(dir, "app", "manifest.json"), JSON.stringify(manifest));
it("verifies exact install bytes and polyfill-first classic shell", async () =>
  expect(await verifyRelease(dir)).toEqual(manifest));
it("detects an asset changed after hashing", async () => {
  await writeFile(path.join(dir, "app", "test", "main-b.js"), "corrupt");
  await expect(verifyRelease(dir)).rejects.toThrow("integrity");
});
it("rejects a duplicate manifest path", async () => {
  manifest.assets.push(manifest.assets[0]);
  await save();
  await expect(verifyRelease(dir)).rejects.toThrow("path");
});
it("never installs the gallery", async () => {
  manifest.assets[0].path = "/app/test/gallery.html";
  await save();
  await expect(verifyRelease(dir)).rejects.toThrow("path");
});
it("rejects path traversal", async () => {
  manifest.assets[0].path = "/app/test/../../index.html";
  await save();
  await expect(verifyRelease(dir)).rejects.toThrow("path");
});
it("detects changed top-level shell", async () => {
  await writeFile(path.join(dir, "index.html"), "different");
  await expect(verifyRelease(dir)).rejects.toThrow("copies");
});

it.each(["ai-renderer-lazy.js", "ai-renderer-math.css", "math.woff2"])(
  "rejects unlisted lazy assets: %s",
  async (file) => {
    await writeFile(path.join(dir, "app", "test", file), "unlisted");
    await expect(verifyRelease(dir)).rejects.toThrow("missing from manifest");
  },
);
