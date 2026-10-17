import { crc32 } from "node:zlib";
import { sha256Hex } from "@talos/base";
/** Deterministic PDF objects, offsets and xref; no external fixture generator. */
export function pdfFixture(pages = 1, image = false, cjk = false): Buffer {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  if (cjk) {
    objects[2] =
      "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>";
    objects.push(
      "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>",
    );
  }
  const kids: number[] = [];
  for (let i = 0; i < pages; i++) {
    const page = objects.length + 1;
    kids.push(page);
    const text = cjk ? "<4F60597D4E16754C>" : `(Hello page ${i + 1})`;
    const stream =
      `BT /F1 20 Tf 40 700 Td ${text} Tj ET\n0.2 0.3 0.6 rg 40 40 80 80 re f\n` +
      (image
        ? "q 80 0 0 80 60 530 cm BI /W 2 /H 2 /CS /RGB /BPC 8 /F /AHx ID FF000000FF00000FFFFFFFFF> EI Q\n"
        : "");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages} >>`;
  let data = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(data);
  data +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
      .join("");
  data += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(data);
}
export interface FixtureEntry {
  name: string;
  bytes: Uint8Array;
}
/** ZIP64 fixtures have independent local and central headers, like the native writer. */
export function zipFixture(entries: FixtureEntry[]): Buffer {
  const chunks: Buffer[] = [],
    central: Buffer[] = [];
  let position = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      bytes = Buffer.from(entry.bytes),
      crc = crc32(bytes);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(45, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(0xffffffff, 18);
    h.writeUInt32LE(0xffffffff, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(20, 28);
    const extra = Buffer.alloc(20);
    extra.writeUInt16LE(1);
    extra.writeUInt16LE(16, 2);
    extra.writeUInt32LE(bytes.length, 4);
    extra.writeUInt32LE(bytes.length, 12);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(45, 4);
    c.writeUInt16LE(45, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(0xffffffff, 20);
    c.writeUInt32LE(0xffffffff, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt16LE(28, 30);
    c.writeUInt32LE(0xffffffff, 42);
    const ce = Buffer.alloc(28);
    extra.copy(ce);
    ce.writeUInt16LE(24, 2);
    ce.writeUInt32LE(position, 20);
    central.push(c, name, ce);
    chunks.push(h, name, extra, bytes);
    position += h.length + name.length + extra.length + bytes.length;
  }
  const directory = Buffer.concat(central),
    z = Buffer.alloc(56);
  z.writeUInt32LE(0x06064b50);
  z.writeUInt32LE(44, 4);
  z.writeUInt16LE(45, 12);
  z.writeUInt16LE(45, 14);
  z.writeUInt32LE(entries.length, 24);
  z.writeUInt32LE(entries.length, 32);
  z.writeUInt32LE(directory.length, 40);
  z.writeUInt32LE(position, 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50);
  locator.writeUInt32LE(position + directory.length, 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(65535, 8);
  end.writeUInt16LE(65535, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([...chunks, directory, z, locator, end]);
}
export function archiveFixture(
  change?: (manifest: Record<string, unknown>) => void,
): Buffer {
  const html = Buffer.from("<html>hello</html>"),
    rid = sha256Hex(html),
    name = `objects/${rid}`;
  const m: Record<string, unknown> = {
    format: "classapp-render-archive",
    version: 2,
    dictionary: null,
    resources: [
      {
        contentId: rid,
        mime: "text/html",
        encoding: "identity",
        rawSize: html.length,
        storedSize: html.length,
        storedOffset: 50 + name.length,
        path: name,
      },
    ],
    files: [{ path: "page.html", contentId: rid }],
    document: {
      layout: "fixed",
      sourceMime: "application/pdf",
      sourcePages: 1,
      firstPage: 1,
      lastPage: 1,
      resolution: 96,
      webpQuality: 80,
      shared: [],
      items: [
        {
          id: "page-1",
          ordinal: 0,
          width: 816,
          height: 1056,
          document: rid,
          dependencies: [],
        },
      ],
    },
  };
  change?.(m);
  return zipFixture([
    { name, bytes: html },
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(m)) },
  ]);
}
/** Standard security-handler header with an unknown password (R2/40-bit RC4). */
export function encryptedPdfFixture(): Buffer {
  let data = pdfFixture().toString().split("xref\n")[0]!;
  data +=
    "6 0 obj\n<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <" +
    "11".repeat(32) +
    "> /U <" +
    "22".repeat(32) +
    "> >>\nendobj\n";
  const offsets = [...data.matchAll(/\d+ 0 obj/g)].map((m) => m.index);
  const xref = Buffer.byteLength(data);
  data +=
    "xref\n0 7\n0000000000 65535 f \n" +
    offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  data +=
    "trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<" +
    "33".repeat(16) +
    "><" +
    "33".repeat(16) +
    ">] >>\nstartxref\n" +
    xref +
    "\n%%EOF\n";
  return Buffer.from(data);
}
