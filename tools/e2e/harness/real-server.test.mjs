import { test, expect } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { stageReleaseAssets } from "./real-server.mjs";

test("second real release preserves binary assets and rehashes its versioned shell and code", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "talos-release-test-"));
  try {
    await mkdir(path.join(dir, "app/first"), { recursive: true });
    const fixtures = [
      [
        "index.html",
        "text/html",
        Buffer.from('<script src="/app/first/main.js"></script>'),
      ],
      ["main.js", "text/javascript", Buffer.from('window.build="first"')],
      ["image.png", "image/png", Buffer.from([0, 128, 255, 64])],
    ];
    const assets = [];
    for (const [name, mime, bytes] of fixtures) {
      await writeFile(path.join(dir, "app/first", name), bytes);
      assets.push({
        path: `/app/first/${name}`,
        mime,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    await writeFile(
      path.join(dir, "app/manifest.json"),
      JSON.stringify({ build: "first", assets }),
    );
    await stageReleaseAssets(dir, "second");
    const manifest = JSON.parse(
      await readFile(path.join(dir, "app/manifest.json"), "utf8"),
    );
    expect(manifest.build).toBe("second");
    for (const asset of manifest.assets) {
      const bytes = await readFile(path.join(dir, asset.path));
      expect(asset.path).toContain("/app/second/");
      expect(asset.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      expect(asset.size).toBe(bytes.length);
    }
    expect(await readFile(path.join(dir, "index.html"), "utf8")).toContain(
      "/app/second/main.js",
    );
    expect(
      await readFile(path.join(dir, "app/second/main.js"), "utf8"),
    ).toContain('build="second"');
    expect(await readFile(path.join(dir, "app/second/image.png"))).toEqual(
      fixtures[2][2],
    );
    expect(
      await readFile(path.join(dir, "app/first/main.js"), "utf8"),
    ).toContain('build="first"');
  } finally {
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});
