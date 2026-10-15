import { describe, it, expect } from "vitest";
import { digest, readZip, writeZip, safePath } from "./archive.ts";
import { verifyRelease } from "./manifest.ts";
describe("bounded release archives", () => {
  it.each([
    "../a",
    "/a",
    "C:/a",
    "a\\b",
    "a/../b",
    "a//b",
    "a.",
    "aux.txt",
    "a/NUL",
    "a:b",
    "a?b",
    "a*b",
    "a|b",
    "a\0b",
  ])("rejects unsafe path %s", (name) => {
    expect(() => safePath(name)).toThrow();
  });
  it("round trips varied binary contents deterministically", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from(
        { length: n * 97 },
        (_, i) => (i * 31 + n) % 256,
      );
      const map = new Map([[`文件-${n}.bin`, bytes]]);
      expect(readZip(writeZip(map)).get(`文件-${n}.bin`)).toEqual(
        Buffer.from(bytes),
      );
    }
  });
  it("rejects case-insensitive collisions", () => {
    expect(() =>
      writeZip(
        new Map([
          ["A", new Uint8Array()],
          ["a", new Uint8Array()],
        ]),
      ),
    ).toThrow();
  });
  it("rejects corrupted payload and directory", () => {
    const bytes = writeZip(new Map([["a", Buffer.from("hello")]]));
    bytes[31] = bytes[31]! ^ 1;
    expect(() => readZip(bytes)).toThrow();
    expect(() => readZip(bytes.subarray(0, -1))).toThrow();
  });
  it("checks complete manifest and outer hash", () => {
    const files = new Map(
      ["server.js", "client/index.html", "shell/sw.js", "package.json"].map(
        (n) => [n, Buffer.from(n)],
      ),
    );
    const manifest = {
      v: 1,
      build: "test",
      platform: "linux-redhat-x64",
      files: [...files].map(([path, b]) => ({
        path,
        size: b.length,
        sha256: digest(b),
      })),
    };
    files.set("release.json", Buffer.from(JSON.stringify(manifest)));
    const bytes = writeZip(files);
    expect(verifyRelease(bytes, digest(bytes)).manifest.build).toBe("test");
    expect(() => verifyRelease(bytes, "0".repeat(64))).toThrow();
    files.set("unexpected", Buffer.from("x"));
    expect(() => verifyRelease(writeZip(files))).toThrow();
  });
});

it("rejects a file that is also another entry's parent", () => {
  expect(() =>
    readZip(
      writeZip(
        new Map([
          ["client", Buffer.from("file")],
          ["client/index.html", Buffer.from("html")],
        ]),
      ),
    ),
  ).toThrow();
});
