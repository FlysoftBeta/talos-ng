import { expect, it } from "vitest";
import { zstdCompressSync, crc32 } from "node:zlib";
import { sha256Hex } from "@talos/base";
import { PdfRenderArchive } from "./archive.ts";
import { archiveFixture, zipFixture } from "../testing/fixtures.ts";
import type { ArchiveManifest } from "./archive-manifest.ts";
function source(bytes: Uint8Array) {
  return {
    size: bytes.length,
    read: async (o: number, l: number) => bytes.slice(o, o + l),
  };
}
it("indexes ZIP64 ranges, reads content and isolates returned manifest mutations", async () => {
  const a = await PdfRenderArchive.open(source(archiveFixture()));
  const rid = a.manifest.resources[0]!.contentId;
  expect(Buffer.from(await a.readDecoded(rid)).toString()).toBe(
    "<html>hello</html>",
  );
  a.manifest.resources.length = 0;
  expect(a.manifest.resources).toHaveLength(1);
  await expect(a.readDecoded("bad")).rejects.toMatchObject({
    code: "E_NOT_FOUND",
  });
});
const negatives: Record<string, (m: ArchiveManifest) => void> = {
  version: (m) => {
    m.version = 2 as 1;
  },
  format: (m) => {
    m.format = "bad" as ArchiveManifest["format"];
  },
  offset: (m) => {
    m.resources[0]!.storedOffset++;
  },
  size: (m) => {
    m.resources[0]!.storedSize++;
  },
  path: (m) => {
    m.resources[0]!.path = "../bad";
  },
  duplicate: (m) => {
    m.resources.push(m.resources[0]!);
  },
  missingRef: (m) => {
    m.document.shared = ["0".repeat(64)];
  },
  duplicatePage: (m) => {
    m.document.items.push(m.document.items[0]!);
  },
  ordinal: (m) => {
    m.document.items[0]!.ordinal = 1;
  },
  dimension: (m) => {
    m.document.items[0]!.width = 0;
  },
  dictionaryMissing: (m) => {
    m.resources[0]!.encoding = "zstd-dictionary";
  },
  dictionaryUnexpected: (m) => {
    m.dictionary = {
      contentId: "0".repeat(64),
      path: "dictionary.zdict",
      size: 1,
      storedOffset: 0,
    };
  },
  fileTraversal: (m) => {
    m.files[0]!.path = "a/../b";
  },
  fileAbsolute: (m) => {
    m.files[0]!.path = "C:/bad";
  },
  fileDuplicate: (m) => {
    m.files.push(m.files[0]!);
  },
  unknownField: (m) => {
    (m as unknown as Record<string, unknown>).extra = 1;
  },
  nonHtml: (m) => {
    m.resources[0]!.mime = "text/plain";
  },
  badPageCount: (m) => {
    m.document.sourcePages = 0;
  },
  rawLimit: (m) => {
    m.resources[0]!.rawSize = 513 * 1024 * 1024;
  },
  badEncoding: (m) => {
    m.resources[0]!.encoding = "bad" as "identity";
  },
  invalidRid: (m) => {
    m.resources[0]!.contentId = "invalid";
  },
  fraction: (m) => {
    m.resources[0]!.rawSize = 1.5;
  },
};
it.each(Object.keys(negatives))("rejects archive manifest %s", async (name) => {
  const bytes = archiveFixture((m) =>
    negatives[name]!(m as unknown as ArchiveManifest),
  );
  await expect(PdfRenderArchive.open(source(bytes))).rejects.toMatchObject({
    code: "E_INTEGRITY",
  });
});
it.each([
  "signature",
  "method",
  "flags",
  "name",
  "crc",
  "truncated",
  "locator",
  "unsafe",
  "endCount",
] as const)("rejects corrupt ZIP %s", async (kind) => {
  let b = archiveFixture();
  switch (kind) {
    case "signature":
      b[0] = 0;
      break;
    case "method":
      b.writeUInt16LE(8, 8);
      break;
    case "flags":
      b.writeUInt16LE(8, 6);
      break;
    case "name":
      b[30] = 0x78;
      break;
    case "crc":
      b.writeUInt32LE(0, 14);
      break;
    case "truncated":
      b = b.subarray(0, -1);
      break;
    case "locator":
      b[b.length - 42] = 0;
      break;
    case "unsafe":
      b.writeUInt32LE(0xffffffff, b.length - 30);
      break;
    case "endCount":
      b.writeUInt16LE(2, b.length - 12);
      break;
  }
  await expect(PdfRenderArchive.open(source(b))).rejects.toMatchObject({
    code: "E_INTEGRITY",
  });
});
it("rejects duplicate ZIP entries and unexpected paths", async () => {
  for (const entries of [
    [
      { name: "manifest.json", bytes: Buffer.from("{}") },
      { name: "manifest.json", bytes: Buffer.from("{}") },
    ],
    [{ name: "../manifest.json", bytes: Buffer.from("{}") }],
  ])
    await expect(
      PdfRenderArchive.open(source(zipFixture(entries))),
    ).rejects.toMatchObject({ code: "E_INTEGRITY" });
});
it("rejects payload corruption and SHA mismatch even with a matching ZIP CRC", async () => {
  const b = archiveFixture();
  const a = await PdfRenderArchive.open(source(b));
  const r = a.manifest.resources[0]!;
  b[r.storedOffset] = b[r.storedOffset]! ^ 1;
  await expect(
    (await PdfRenderArchive.open(source(b))).readDecoded(r.contentId),
  ).rejects.toMatchObject({ code: "E_INTEGRITY" });
  const checksum = crc32(
    b.subarray(r.storedOffset, r.storedOffset + r.storedSize),
  );
  b.writeUInt32LE(checksum, 14);
  const central = b.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  b.writeUInt32LE(checksum, central + 16);
  await expect(
    (await PdfRenderArchive.open(source(b))).readDecoded(r.contentId),
  ).rejects.toMatchObject({ code: "E_INTEGRITY" });
});
it.each([false, true])(
  "decodes zstd, dictionary=%s with hash verification",
  async (withDictionary) => {
    const raw = Buffer.from("<html>repeated sample</html>".repeat(500));
    const dict = Buffer.from("repeated sample html ".repeat(100));
    const compressed = zstdCompressSync(
      raw,
      withDictionary ? { dictionary: dict } : {},
    );
    const rid = sha256Hex(raw),
      name = `objects/${rid}.zst`;
    let m!: ArchiveManifest;
    archiveFixture((v) => {
      m = v as unknown as ArchiveManifest;
    });
    const dictEntry = { name: "dictionary.zdict", bytes: dict };
    const offset =
      (withDictionary ? 50 + dictEntry.name.length + dict.length : 0) +
      50 +
      name.length;
    m.resources = [
      {
        contentId: rid,
        path: name,
        mime: "text/html",
        encoding: withDictionary ? "zstd-dictionary" : "zstd",
        rawSize: raw.length,
        storedSize: compressed.length,
        storedOffset: offset,
      },
    ];
    m.files = [{ path: "a.html", contentId: rid }];
    m.document.items[0]!.document = rid;
    m.dictionary = withDictionary
      ? {
          contentId: sha256Hex(dict),
          path: "dictionary.zdict",
          size: dict.length,
          storedOffset: 50 + dictEntry.name.length,
        }
      : null;
    const entries = [
      ...(withDictionary ? [dictEntry] : []),
      { name, bytes: compressed },
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(m)) },
    ];
    const a = await PdfRenderArchive.open(source(zipFixture(entries)));
    expect(await a.readDecoded(rid)).toEqual(raw);
    m.resources[0]!.rawSize = 1;
    entries[entries.length - 1] = {
      name: "manifest.json",
      bytes: Buffer.from(JSON.stringify(m)),
    };
    await expect(
      (await PdfRenderArchive.open(source(zipFixture(entries)))).readDecoded(
        rid,
      ),
    ).rejects.toMatchObject({ code: "E_INTEGRITY" });
    if (withDictionary) {
      dict[0] = dict[0]! ^ 1;
      await expect(
        PdfRenderArchive.open(source(zipFixture(entries))),
      ).rejects.toMatchObject({ code: "E_INTEGRITY" });
    }
  },
);
