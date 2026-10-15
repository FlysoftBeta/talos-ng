import { gunzipSync } from "node:zlib";
import { it, expect } from "vitest";
import { tarGz } from "./tar.ts";
it("writes portable ustar headers, executable modes, checksums and block padding", () => {
  const files = new Map([
    ["runtime/node", Buffer.alloc(513, 42)],
    [
      "releases/build/client/" + "long-directory-".repeat(5) + "/app.js",
      Buffer.from("client"),
    ],
  ]);
  const bytes = gunzipSync(tarGz(files));
  let offset = 0;
  for (const [name, data] of files) {
    const h = bytes.subarray(offset, offset + 512);
    const field = (a: number, b: number) =>
      h.subarray(a, b).toString().replace(/\0.*$/s, "");
    const prefix = field(345, 500);
    expect((prefix ? prefix + "/" : "") + field(0, 100)).toBe(name);
    expect(field(257, 263)).toBe("ustar");
    const expected = parseInt(field(148, 156), 8),
      copy = Buffer.from(h);
    copy.fill(32, 148, 156);
    expect(copy.reduce((n, b) => n + b, 0)).toBe(expected);
    expect(parseInt(field(100, 108), 8)).toBe(
      name === "runtime/node" ? 0o755 : 0o644,
    );
    expect(parseInt(field(124, 136), 8)).toBe(data.length);
    expect(bytes.subarray(offset + 512, offset + 512 + data.length)).toEqual(
      data,
    );
    offset += 512 + Math.ceil(data.length / 512) * 512;
  }
  expect(bytes.subarray(offset)).toEqual(Buffer.alloc(1024));
});
it("refuses names that ustar cannot represent instead of truncating", () => {
  expect(() =>
    tarGz(new Map([["directory/" + "a".repeat(110), Buffer.alloc(0)]])),
  ).toThrow();
  expect(() => tarGz(new Map([["../escape", Buffer.alloc(0)]]))).toThrow();
});
