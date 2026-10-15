import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { sha256Hex } from "@talos/base";
import { loadHttpAssets } from "./http-assets.ts";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 10,
      }),
    ),
  );
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "talos-release-"));
  dirs.push(dir);
  await mkdir(join(dir, "app", "v1.2"), { recursive: true });
  const bytes = Buffer.from(
    '<!doctype html><script src="/app/v1.2/main-abcd.js"></script>',
  );
  await writeFile(join(dir, "app", "v1.2", "index.html"), bytes);
  const manifest = {
    build: "v1.2",
    assets: [
      {
        path: "/app/v1.2/index.html",
        size: bytes.length,
        sha256: sha256Hex(bytes),
        mime: "text/html; charset=utf-8",
      },
    ],
  };
  const save = async () =>
    writeFile(join(dir, "app", "manifest.json"), JSON.stringify(manifest));
  await save();
  return { dir, bytes, manifest, save };
}
it("uses the emitted build and exact manifest, excludes unlisted files, snapshots worker bytes", async () => {
  const { dir, bytes, manifest } = await fixture();
  await writeFile(join(dir, "index.html"), "stale shell");
  await writeFile(join(dir, "gallery.html"), "private gallery");
  const worker = join(dir, "worker.js");
  await writeFile(worker, "self.onfetch=function(){};");
  const result = await loadHttpAssets(dir, "fallback", worker);
  expect(result.manifest).toEqual(manifest);
  expect(result.files.get("/")!.bytes).toEqual(bytes);
  expect(result.files.has("/gallery.html")).toBe(false);
  expect(result.files.get("/sw.js")!.mime).toContain("javascript");
  await writeFile(worker, "changed");
  expect(Buffer.from(result.files.get("/sw.js")!.bytes).toString()).toContain(
    "onfetch",
  );
});
it.each([
  "/app/v1.2/../secret",
  "/app/other/index.html",
  "/app/v1.2/%2e%2e/secret",
  "/app/v1.2/.hidden",
  "/app/v1.2/C:secret",
])("rejects manifest path %s", async (path) => {
  const f = await fixture();
  f.manifest.assets[0]!.path = path;
  await f.save();
  await expect(loadHttpAssets(f.dir, "test")).rejects.toMatchObject({
    code: "E_INVALID",
  });
});
it("rejects corrupt assets", async () => {
  const f = await fixture();
  await writeFile(join(f.dir, "app", "v1.2", "index.html"), "corrupt");
  await expect(loadHttpAssets(f.dir, "test")).rejects.toMatchObject({
    code: "E_INTEGRITY",
  });
});
it("rejects duplicate manifest assets", async () => {
  const f = await fixture();
  f.manifest.assets.push(f.manifest.assets[0]!);
  await f.save();
  await expect(loadHttpAssets(f.dir, "test")).rejects.toMatchObject({
    code: "E_INVALID",
  });
});
it("a missing client directory is an empty snapshot", async () => {
  expect(
    (await loadHttpAssets(join(tmpdir(), "talos-missing-dist"), "test"))
      .manifest,
  ).toEqual({ build: "test", assets: [] });
});
