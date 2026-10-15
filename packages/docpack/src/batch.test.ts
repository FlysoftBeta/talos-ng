import { describe, expect, it } from "vitest";
import { sha256Hex, utf8Encode, writeU32BE } from "@talos/base";
import {
  PackReader,
  PackWriter,
  MemorySpool,
  decodeResourceBatch,
  encodeResourceBatch,
  MAX_RESOURCE_BYTES,
  MAX_RESOURCES,
} from "./index.ts";

const rid = (s: string) => sha256Hex(utf8Encode(s));
const code = (c: string) => expect.objectContaining({ code: c });

describe("resource batch framing", () => {
  it("preserves order, encodings and exact payload bytes", () => {
    const records = [
      { rid: rid("a"), enc: "raw" as const, bytes: Uint8Array.of(1, 2, 3) },
      { rid: rid("b"), enc: "deflate" as const, bytes: new Uint8Array(0) },
      {
        rid: rid("c"),
        enc: "raw" as const,
        bytes: new Uint8Array(70_000).fill(9),
      },
    ];
    expect(decodeResourceBatch(encodeResourceBatch(records))).toEqual(records);
  });
  it("refuses to encode a bad rid, encoding, oversize record or too many records", () => {
    const ok = { rid: rid("a"), enc: "raw" as const, bytes: new Uint8Array(1) };
    expect(() => encodeResourceBatch([{ ...ok, rid: "xyz" }])).toThrowError(
      code("E_PROTOCOL"),
    );
    expect(() =>
      encodeResourceBatch([{ ...ok, rid: rid("a").toUpperCase() }]),
    ).toThrow();
    expect(() =>
      encodeResourceBatch([{ ...ok, enc: "gzip" as never }]),
    ).toThrow();
    expect(() =>
      encodeResourceBatch([
        { ...ok, bytes: new Uint8Array(MAX_RESOURCE_BYTES + 1) },
      ]),
    ).toThrow();
    expect(() =>
      encodeResourceBatch(Array.from({ length: MAX_RESOURCES + 1 }, () => ok)),
    ).toThrow();
  });
  it("rejects malformed wire bytes: short tail, length lies, unknown encoding", () => {
    const good = encodeResourceBatch([
      { rid: rid("a"), enc: "raw", bytes: Uint8Array.of(7) },
    ]);
    expect(() =>
      decodeResourceBatch(good.subarray(0, good.length - 1)),
    ).toThrow();
    expect(() => decodeResourceBatch(good.subarray(0, 20))).toThrow();
    const shortLen = good.slice();
    writeU32BE(shortLen, 32, 0);
    expect(() => decodeResourceBatch(shortLen)).toThrow();
    const hugeLen = good.slice();
    writeU32BE(hugeLen, 0xffffffff, 0);
    expect(() => decodeResourceBatch(hugeLen)).toThrow();
    const badEnc = good.slice();
    badEnc[36] = 2;
    expect(() => decodeResourceBatch(badEnc)).toThrowError(code("E_PROTOCOL"));
    expect(decodeResourceBatch(new Uint8Array(0))).toEqual([]);
  });
});

describe("pack reader lifecycle", () => {
  it("refuses manifest access before open and unknown or inherited resource ids", async () => {
    const sink = new MemorySpool();
    const writer = new PackWriter(sink, new MemorySpool(), { kind: "flow" });
    const id = await writer.addResource(utf8Encode("x"), "text/plain");
    writer.addUnit({ id: "u", entry: id, deps: [], chars: 1 });
    writer.setShared([]);
    await writer.finish();
    const reader = await PackReader.open(sink);
    await expect(reader.readStored("0".repeat(64))).rejects.toBeInstanceOf(
      Error,
    );
    await expect(reader.readStored("constructor")).rejects.toBeInstanceOf(
      Error,
    );
    await expect(reader.readStored("__proto__")).rejects.toBeInstanceOf(Error);
    expect(reader.manifest).not.toBe(reader.manifest);
  });
});
