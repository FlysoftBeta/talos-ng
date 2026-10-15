import { describe, expect, it } from "vitest";
import { sha256Hex, utf8Encode, concat, writeU32BE } from "@talos/base";
import {
  PackWriter,
  PackReader,
  MemorySpool,
  validateManifest,
  decodeResource,
  encodeResourceBatch,
  decodeResourceBatch,
  MAX_MANIFEST_BYTES,
  MAX_RESOURCE_BYTES,
} from "./index.ts";
import type { Manifest } from "./index.ts";
const bytes = utf8Encode("Hello, 世界! ".repeat(100));
const rid = sha256Hex(bytes);
function manifest(): Manifest {
  return {
    v: 1,
    kind: "paged",
    meta: {},
    units: [{ ordinal: 0, id: "one", entry: rid, deps: [], w: 100, h: 200 }],
    shared: [rid],
    resources: {
      [rid]: {
        mime: "text/plain",
        enc: "raw",
        size: bytes.length,
        stored: bytes.length,
        offset: 0,
      },
    },
  };
}
async function pack(kind: "paged" | "flow" = "flow") {
  const sink = new MemorySpool();
  const writer = new PackWriter(sink, new MemorySpool(), {
    kind,
    title: "Title",
  });
  const id = await writer.addResource(bytes, "text/plain");
  writer.addUnit({
    id: "a",
    entry: id,
    deps: [],
    ...(kind === "paged" ? { w: 100, h: 200 } : { chars: 100 }),
  });
  writer.setShared([id]);
  writer.setOutline([{ ordinal: 0, title: "First", level: 1 }]);
  const m = await writer.finish();
  return { sink, writer, m, id };
}
describe("pack", () => {
  it.each(["flow", "paged"] as const)("round trips %s", async (kind) => {
    const { sink, m, id } = await pack(kind);
    const reader = await PackReader.open(sink);
    expect(reader.manifest).toEqual(m);
    expect(await reader.readDecoded(id)).toEqual(bytes);
    expect(m.resources[id]!.enc).toBe("deflate");
    expect(reader.clientManifest().resources[id]).not.toHaveProperty("offset");
    expect((await reader.readStored(id)).length).toBeLessThan(bytes.length);
  });
  it("deduplicates by decoded hash, retaining first MIME", async () => {
    const sink = new MemorySpool(),
      spool = new MemorySpool(),
      w = new PackWriter(sink, spool, { kind: "flow" });
    expect(await w.addResource(bytes, "text/plain")).toBe(
      await w.addResource(bytes, "application/octet-stream"),
    );
    const m = await w.finish();
    expect(Object.keys(m.resources)).toHaveLength(1);
    expect(spool.size).toBe(m.resources[rid]!.stored);
  });
  it("compresses only eligible MIME at the inclusive 10% threshold", async () => {
    for (const n of [90, 91]) {
      const sink = new MemorySpool(),
        w = new PackWriter(sink, new MemorySpool(), {
          kind: "flow",
          compress: () => new Uint8Array(n),
        });
      const a = await w.addResource(new Uint8Array(100), "text/plain");
      const b = await w.addResource(new Uint8Array(101), "image/webp");
      const m = await w.finish();
      expect(m.resources[a]!.enc).toBe(n === 90 ? "deflate" : "raw");
      expect(m.resources[b]!.enc).toBe("raw");
    }
  });
  it("rejects modified compressed/raw data and mismatched size/hash", async () => {
    const { sink, id } = await pack();
    const r = await PackReader.open(sink);
    const stored = await r.readStored(id);
    stored[0] = stored[0]! ^ 255;
    expect(() =>
      decodeResource("deflate", stored, { rid: id, size: bytes.length }),
    ).toThrowError(expect.objectContaining({ code: "E_INTEGRITY" }));
    for (const exp of [
      { rid, size: 1 },
      { rid: "0".repeat(64), size: bytes.length },
    ])
      expect(() => decodeResource("raw", bytes, exp)).toThrowError(
        expect.objectContaining({ code: "E_INTEGRITY" }),
      );
  });
  it("rejects over-expanding deflate without accepting a valid prefix hash", async () => {
    const { sink, id } = await pack();
    const r = await PackReader.open(sink);
    const compressed = await r.readStored(id);
    const prefix = bytes.slice(0, 10);
    expect(() =>
      decodeResource("deflate", compressed, {
        rid: sha256Hex(prefix),
        size: prefix.length,
      }),
    ).toThrowError(expect.objectContaining({ code: "E_INTEGRITY" }));
    expect(() =>
      decodeResource("deflate", new Uint8Array([255]), {
        rid: id,
        size: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "E_INTEGRITY" }));
    expect((await r.readDecoded(id)).length).toBe(bytes.length);
  });
  it("handles empty resource", async () => {
    const sink = new MemorySpool(),
      w = new PackWriter(sink, new MemorySpool(), { kind: "flow" });
    const id = await w.addResource(new Uint8Array(), "text/plain");
    await w.finish();
    expect(await (await PackReader.open(sink)).readDecoded(id)).toEqual(
      new Uint8Array(),
    );
  });
  it("enforces writer and reader lifecycle", async () => {
    const { writer, sink } = await pack();
    await expect(writer.finish()).rejects.toMatchObject({ code: "E_CONFLICT" });
    expect(() => writer.setShared([])).toThrow();
    const r = new PackReader(sink);
    expect(() => r.manifest).toThrow();
    await r.open();
    await expect(r.readStored("missing")).rejects.toMatchObject({
      code: "E_NOT_FOUND",
    });
    const m = r.manifest;
    m.units.length = 0;
    expect(r.manifest.units).toHaveLength(1);
  });
  it("rejects truncation, bad magic and huge manifest length", async () => {
    const { sink } = await pack();
    const all = await sink.read(0, sink.size);
    for (const b of [all.slice(0, 10), new Uint8Array(12)])
      await expect(
        PackReader.open({
          size: b.length,
          read: async (o, l) => b.slice(o, o + l),
        }),
      ).rejects.toBeDefined();
    writeU32BE(all, MAX_MANIFEST_BYTES + 1, 8);
    await expect(
      PackReader.open({
        size: all.length,
        read: async (o, l) => all.slice(o, o + l),
      }),
    ).rejects.toMatchObject({ code: "E_TOO_LARGE" });
  });
  it("propagates sink failures and does not permit a retry to append corrupt output", async () => {
    const w = new PackWriter(
      {
        write: async () => {
          throw new Error("disk");
        },
      },
      new MemorySpool(),
      { kind: "flow" },
    );
    await expect(w.finish()).rejects.toThrow("disk");
    await expect(w.finish()).rejects.toMatchObject({ code: "E_CONFLICT" });
  });
});
describe("manifest negatives", () => {
  const negatives: Record<string, (m: Manifest) => void> = {
    version: (m) => {
      (m as unknown as { v: number }).v = 2;
    },
    kind: (m) => {
      (m as unknown as { kind: string }).kind = "bad";
    },
    ordinal: (m) => {
      m.units[0]!.ordinal = 1;
    },
    duplicate: (m) => {
      m.units.push({ ...m.units[0]!, ordinal: 1 });
    },
    entry: (m) => {
      m.units[0]!.entry = "0".repeat(64);
    },
    deps: (m) => {
      m.units[0]!.deps = ["0".repeat(64)];
    },
    shared: (m) => {
      m.shared = ["0".repeat(64)];
    },
    width: (m) => {
      m.units[0]!.w = 0;
    },
    height: (m) => {
      m.units[0]!.h = 1.5;
    },
    size: (m) => {
      m.resources[rid]!.size = MAX_RESOURCE_BYTES + 1;
    },
    stored: (m) => {
      m.resources[rid]!.stored = MAX_RESOURCE_BYTES + 1;
    },
    offset: (m) => {
      m.resources[rid]!.offset = 1;
    },
    negative: (m) => {
      m.resources[rid]!.offset = -1;
    },
    unsafe: (m) => {
      m.resources[rid]!.offset = Number.MAX_SAFE_INTEGER + 1;
    },
    encoding: (m) => {
      (m.resources[rid] as unknown as { enc: string }).enc = "zstd";
    },
    mime: (m) => {
      m.resources[rid]!.mime = "";
    },
    hash: (m) => {
      m.resources.bad = m.resources[rid]!;
    },
    overlap: (m) => {
      m.resources["0".repeat(64)] = { ...m.resources[rid]! };
    },
    rawSize: (m) => {
      m.resources[rid]!.size--;
    },
    outline: (m) => {
      m.outline = [{ ordinal: 1, title: "bad", level: 1 }];
    },
    chars: (m) => {
      m.units[0]!.chars = -1;
    },
    meta: (m) => {
      (m as unknown as { meta: null }).meta = null;
    },
  };
  it.each(Object.keys(negatives))("rejects %s", (name) => {
    const m = manifest();
    negatives[name]!(m);
    expect(() => validateManifest(m, bytes.length)).toThrow();
  });
  it("rejects too many resources before inspecting them", () => {
    const m = manifest();
    m.resources = Object.fromEntries(
      Array.from({ length: 200001 }, (_, i) => [String(i), {}]),
    ) as Manifest["resources"];
    expect(() => validateManifest(m, bytes.length)).toThrowError(
      expect.objectContaining({ code: "E_TOO_LARGE" }),
    );
  });
  it("permits adjacent and empty ranges", () => {
    const m = manifest();
    m.resources["0".repeat(64)] = {
      ...m.resources[rid]!,
      offset: bytes.length,
      stored: 0,
      size: 0,
    };
    expect(validateManifest(m, bytes.length)).toEqual(m);
  });
});
describe("delivery framing", () => {
  it("round trips records including empty batch/payload", () => {
    const records = [
      { rid, enc: "raw" as const, bytes },
      { rid, enc: "deflate" as const, bytes: new Uint8Array() },
    ];
    expect(decodeResourceBatch(encodeResourceBatch(records))).toEqual(records);
    expect(decodeResourceBatch(new Uint8Array())).toEqual([]);
  });
  it("rejects truncated, invalid lengths, encoding, and trailing garbage", () => {
    const frame = encodeResourceBatch([{ rid, enc: "raw", bytes }]);
    for (const b of [
      frame.slice(0, 36),
      frame.slice(0, -1),
      concat(frame, new Uint8Array([1])),
    ])
      expect(() => decodeResourceBatch(b)).toThrow();
    frame[36] = 2;
    expect(() => decodeResourceBatch(frame)).toThrow();
    frame[36] = 0;
    writeU32BE(frame, 32);
    expect(() => decodeResourceBatch(frame)).toThrow();
  });
  it("randomized byte records survive framing", () => {
    let seed = 123;
    for (let n = 0; n < 60; n++) {
      const b = Uint8Array.from({ length: n * 7 }, () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed >>> 24;
      });
      const records = [{ rid: sha256Hex(b), enc: "raw" as const, bytes: b }];
      expect(decodeResourceBatch(encodeResourceBatch(records))).toEqual(
        records,
      );
    }
  });
});
