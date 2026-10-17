import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gunzipSync } from "node:zlib";
import {
  verifyRelease,
  ReleaseFiles,
  digest,
} from "../../packages/launcher/src/index.ts";

export async function checkLinuxStructure(root, build, target, other) {
  const dir = join(root, "dist/release/update"),
    full = join(root, "dist/release/full");
  const base = `talos-${build}-${target}`;
  const bytes = await readFile(join(dir, base + "-update.zip"));
  const { files, manifest } = verifyRelease(bytes);
  assert.equal(manifest.platform, target);
  assert.equal(files.get("vendor/pdfrender/target").toString().trim(), target);
  const flavor = target.replace(/-x64$/, "");
  assert.ok(files.has(`vendor/pdfrender/${flavor}/pdfrender`));
  assert.ok(files.has(`vendor/pdfrender/${flavor}/COPYING`));
  for (const name of files.keys())
    if (name.startsWith("vendor/pdfrender/") && name.split("/").length > 3)
      assert.ok(name.startsWith(`vendor/pdfrender/${flavor}/`), name);
  assert.ok(files.has("vendor/media/yt-dlp"));
  assert.ok(
    files.has(
      "vendor/media/plugins/talos-music/yt_dlp_plugins/extractor/talos_music.py",
    ),
  );
  assert.ok(![...files.keys()].some((name) => /\.dll$|\.exe$/i.test(name)));
  const cloud = JSON.parse(
    await readFile(join(dir, base + "-update.zip.json"), "utf8"),
  );
  assert.equal(cloud.platform, target);
  assert.equal(cloud.sha256, digest(bytes));
  assert.equal(cloud.size, bytes.length);
  const tar = gunzipSync(await readFile(join(full, base + ".tar.gz")));
  const entries = new Map();
  for (let p = 0; p + 512 <= tar.length;) {
    const tail = tar
      .subarray(p, p + 100)
      .toString()
      .replace(/\0.*$/s, "");
    if (!tail) break;
    const prefix = tar
      .subarray(p + 345, p + 500)
      .toString()
      .replace(/\0.*$/s, "");
    const name = prefix ? prefix + "/" + tail : tail;
    const size = parseInt(tar.subarray(p + 124, p + 136).toString(), 8);
    entries.set(name, tar.subarray(p + 512, p + 512 + size));
    if (
      name === "start.sh" ||
      name === "runtime/node" ||
      name.endsWith("/pdfrender") ||
      name.endsWith("/yt-dlp")
    )
      assert.ok(
        parseInt(tar.subarray(p + 100, p + 108).toString(), 8) & 0o111,
        name,
      );
    p += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(entries.get("target").toString().trim(), target);
  assert.match(
    entries.get("start.sh").toString(),
    /exec \.\/runtime\/node \.\/launcher.js \./,
  );
  for (const [name, data] of files)
    assert.deepEqual(entries.get(`releases/${build}/${name}`), data, name);
  const scratch = await mkdtemp(join(tmpdir(), "target-guard-"));
  try {
    await writeFile(join(scratch, "target"), other);
    await assert.rejects(
      new ReleaseFiles(scratch).stage(bytes, digest(bytes)),
      /Update target mismatch/,
    );
    assert.deepEqual(
      await readdir(scratch),
      ["target"],
      "reject before writing a release",
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  console.log(
    `STRUCTURE PASSED: ${target}; contents, hashes, executable modes, start script, rejected by ${other}.`,
  );
}
