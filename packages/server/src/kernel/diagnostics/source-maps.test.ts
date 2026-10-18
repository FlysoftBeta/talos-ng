import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SourceMaps } from "./source-maps.ts";

// "a.ts" line 1 -> generated line 1, column 10 (VLQ segment: [10,0,0,0]).
const map = JSON.stringify({
  version: 3,
  sources: ["src/a.ts"],
  names: [],
  mappings: "UAAA",
  file: "main-x.js",
});
describe("SourceMaps", () => {
  const dir = mkdtempSync(join(tmpdir(), "maps-"));
  mkdirSync(join(dir, "b1"));
  writeFileSync(join(dir, "b1", "main-x.js.map"), map);
  writeFileSync(join(dir, "server.js.map"), map);
  const maps = new SourceMaps(dir, "b1");
  it("restores client and server frames and leaves unknown ones", () => {
    const client =
      "    at f (https://h/app/b1/main-x.js:1:11)\n    at g (https://h/app/b1/other.js:1:11)";
    expect(maps.restore(client, "client", "b1")).toBe(
      "    at f (src/a.ts:1:1)\n    at g (https://h/app/b1/other.js:1:11)",
    );
    expect(
      maps.restore("    at h (file:///x/server.js:1:11)", "server", "b1"),
    ).toContain("src/a.ts:1:1");
  });
  it("never reads outside the maps directory or for another build", () => {
    expect(
      maps.restore("    at f (https://h/main-x.js:1:11)", "client", "../b1"),
    ).toContain("main-x.js:1:11");
    expect(
      maps.restore("    at h (file:///x/server.js:1:11)", "server", "b2"),
    ).toContain("server.js:1:11");
  });
});
