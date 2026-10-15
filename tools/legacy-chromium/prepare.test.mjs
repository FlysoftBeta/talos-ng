import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { prepareChrome70 } from "./prepare.mjs";

const supported = process.platform === "linux" && process.arch === "x64";
test.skipIf(!supported)(
  "snapshot download rejects corruption and removes temporary files",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "talos-snapshot-test-"));
    try {
      await assert.rejects(
        prepareChrome70({
          cache: path.join(root, "snapshot"),
          fetch: async () => new Response("corrupt"),
        }),
        /checksum mismatch/,
      );
      assert.deepEqual(await readdir(root), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
test.skipIf(!supported)(
  "snapshot download reports HTTP failures with status",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "talos-snapshot-test-"));
    try {
      await assert.rejects(
        prepareChrome70({
          cache: path.join(root, "snapshot"),
          fetch: async () => new Response("missing", { status: 404 }),
        }),
        /HTTP 404/,
      );
      assert.deepEqual(await readdir(root), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
