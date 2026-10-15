import { mkdtemp, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, describe } from "vitest";
import { MemorySpool, PackReader } from "@talos/docpack";
import {
  createTextConverter,
  decodeText,
  segmentText,
  textOutline,
  createConverterRegistry,
  createPdfConverter,
  PdfRenderRunner,
  resolvePdfRender,
  FileAccess,
  removeTemp,
} from "../index.ts";
import type { ConvertCtx } from "../index.ts";
import { pdfFixture, encryptedPdfFixture } from "../testing/fixtures.ts";
let dir: string;
let ctx: ConvertCtx;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "docpipe-test-"));
  ctx = {
    signal: new AbortController().signal,
    tmpDir: path.join(dir, "tmp"),
    progress: () => {},
    log: () => {},
  };
});
afterEach(async () => removeTemp(dir));
it("decodes UTF-8 BOM, GB18030, normalizes, strips NULs", () => {
  expect(decodeText(Buffer.from("\uFEFF A\0\r\nB\rC "))).toBe("A\nB\nC");
  expect(decodeText(Uint8Array.of(0xd6, 0xd0, 0xce, 0xc4))).toBe("中文");
  expect(decodeText(Uint8Array.of(0x94, 0x39, 0xfc, 0x36))).toBe("😀");
  expect(() => decodeText(Uint8Array.of(0xff))).toThrow();
});
it("preserves text and surrogate boundaries for huge paragraphs and random Unicode", () => {
  let seed = 3;
  for (let n = 0; n < 50; n++) {
    let s = "";
    for (let i = 0; i < 17000; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      s += ["a", "😀", "。", "\n", "中"][seed % 5];
    }
    const chunks = segmentText(s);
    expect(chunks.map((c) => c.text).join("")).toBe(s);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(16000);
      expect(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(c.text)).toBe(false);
    }
  }
  const huge = segmentText("😀".repeat(50000));
  expect(huge.map((c) => c.text).join("")).toBe("😀".repeat(50000));
  expect(() => segmentText("x", 1)).toThrow();
});
it("prefers paragraphs and then sentence boundaries", () => {
  const para = "a".repeat(7000) + "\n" + "b".repeat(7000);
  expect(segmentText(para)[0]!.text.length).toBe(7001);
  const sentence = "a".repeat(7900) + "。" + "b".repeat(10000);
  expect(segmentText(sentence)[0]!.text.length).toBe(7901);
});
it("finds Chinese, English and markdown headings with correct ordinals", () => {
  const text =
    "第一章 开始\n" +
    "a".repeat(9000) +
    "\nChapter 2 Hello\n## 小节\n第三回故事";
  const segments = segmentText(text);
  const o = textOutline(text, segments);
  expect(o.map((v) => v.title)).toEqual([
    "第一章 开始",
    "Chapter 2 Hello",
    "小节",
    "第三回故事",
  ]);
  expect(o[2]!.level).toBe(2);
  expect(o[1]!.ordinal).toBeGreaterThan(0);
});
it("converts text to valid flow pack and cleans spool", async () => {
  const text = "# Title\n" + "你好😀。\n".repeat(3000);
  const input = path.join(dir, "input.txt");
  await writeFile(input, text);
  const sink = new MemorySpool();
  const summary = await createConverterRegistry([
    createTextConverter(),
  ]).convert({ path: input, name: "input.txt" }, { objectSink: sink }, ctx);
  const r = await PackReader.open(sink);
  expect(summary.bytes).toBe(sink.size);
  expect(r.manifest.meta.chars).toBe(text.trim().length);
  expect(r.manifest.units.reduce((n, u) => n + u.chars!, 0)).toBe(
    text.trim().length,
  );
  let restored = "";
  for (const u of r.manifest.units)
    restored += Buffer.from(await r.readDecoded(u.entry)).toString();
  expect(restored).toBe(text.trim());
  expect(await readdir(ctx.tmpDir)).toEqual([]);
});
it("detects magic before misleading extension/MIME, and rejects unknown files", async () => {
  const fake = {
    id: "pdf",
    detect: (head: Uint8Array, name: string) =>
      Buffer.from(head).toString().startsWith("%PDF-") || name.endsWith(".pdf"),
    convert: async () => {
      throw new Error();
    },
  };
  const registry = createConverterRegistry([createTextConverter(), fake]);
  expect(
    registry.detect(Buffer.from("%PDF-1.4"), "a.txt", "text/plain")?.id,
  ).toBe("pdf");
  expect(registry.detect(Buffer.from("abc"), "a.txt")?.id).toBe("text");
  const input = path.join(dir, "x");
  await writeFile(input, "random");
  await expect(
    registry.convert(
      { path: input, name: "x.bin" },
      { objectSink: new MemorySpool() },
      ctx,
    ),
  ).rejects.toMatchObject({ code: "E_INVALID", message: "无法识别的文件格式" });
});
it("publishes a file, refuses overwrite, and cleans partial failures", async () => {
  const input = path.join(dir, "in.txt"),
    out = path.join(dir, "out.tdp");
  await writeFile(input, "hello");
  const registry = createConverterRegistry([createTextConverter()]);
  await registry.convert(
    { path: input, name: "in.txt" },
    { filePath: out },
    ctx,
  );
  const f = await FileAccess.open(out);
  try {
    expect((await PackReader.open(f)).manifest.kind).toBe("flow");
  } finally {
    await f.close();
  }
  await expect(
    registry.convert({ path: input, name: "in.txt" }, { filePath: out }, ctx),
  ).rejects.toMatchObject({ code: "E_CONFLICT" });
  expect((await readdir(dir)).filter((n) => n.startsWith(".docpipe"))).toEqual(
    [],
  );
});
it("fails on empty text, missing source, cancellation and sink failure", async () => {
  const input = path.join(dir, "empty.txt");
  await writeFile(input, " \0 ");
  const registry = createConverterRegistry([createTextConverter()]);
  await expect(
    registry.convert(
      { path: input, name: "empty.txt" },
      { objectSink: new MemorySpool() },
      ctx,
    ),
  ).rejects.toMatchObject({ code: "E_INVALID" });
  await expect(
    registry.convert(
      { path: input + "missing", name: "empty.txt" },
      { objectSink: new MemorySpool() },
      ctx,
    ),
  ).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  await writeFile(input, "text");
  await expect(
    registry.convert(
      { path: input, name: "empty.txt" },
      {
        objectSink: {
          write: async () => {
            throw new Error("disk");
          },
        },
      },
      ctx,
    ),
  ).rejects.toMatchObject({ code: "E_INTERNAL" });
  const c = new AbortController();
  c.abort();
  await expect(
    registry.convert(
      { path: input, name: "empty.txt" },
      { objectSink: new MemorySpool() },
      { ...ctx, signal: c.signal },
    ),
  ).rejects.toMatchObject({ code: "E_CANCELLED" });
  expect(await readdir(ctx.tmpDir)).toEqual([]);
});
const vendorDir = path.resolve(
  import.meta.dirname,
  "../../../../vendor/pdfrender",
);
describe.skipIf(process.env.TALOS_SKIP_PDFRENDER === "1")(
  "real native renderer",
  () => {
    it.each([
      { pages: 1, image: false, cjk: false },
      { pages: 3, image: false, cjk: false },
      { pages: 1, image: true, cjk: false },
      { pages: 1, image: false, cjk: true },
    ])(
      "converts $pages pages, raster=$image, CJK=$cjk",
      async ({ pages, image, cjk }) => {
        const location = await resolvePdfRender({ vendorDir });
        const input = path.join(dir, "input.pdf");
        await writeFile(input, pdfFixture(pages, image, cjk));
        const sink = new MemorySpool();
        const runner = new PdfRenderRunner({ location });
        const result = await createPdfConverter(runner).convert(
          { path: input, name: "test.pdf" },
          sink,
          ctx,
        );
        expect(result.units).toBe(pages);
        const r = await PackReader.open(sink);
        expect(r.manifest.units).toHaveLength(pages);
        for (const u of r.manifest.units) {
          expect(u.w).toBe(816);
          expect(u.h).toBe(1056);
          expect(r.manifest.resources[u.entry]!.mime).toMatch(/^text\/html/);
          expect(
            Buffer.from(await r.readDecoded(u.entry)).toString(),
          ).toContain("<");
        }
        for (const rid of Object.keys(r.manifest.resources))
          await r.readDecoded(rid);
        if (image)
          expect(
            Object.values(r.manifest.resources).some(
              (r) => r.mime === "image/webp",
            ),
          ).toBe(true);
        expect(await readdir(ctx.tmpDir)).toEqual([]);
      },
      30000,
    );
    it("rejects password-protected PDFs with Chinese message", async () => {
      const input = path.join(dir, "encrypted.pdf");
      await writeFile(input, encryptedPdfFixture());
      const runner = new PdfRenderRunner({
        location: await resolvePdfRender({ vendorDir }),
      });
      await expect(
        createPdfConverter(runner).convert(
          { path: input, name: "encrypted.pdf" },
          new MemorySpool(),
          ctx,
        ),
      ).rejects.toMatchObject({
        code: "E_INVALID",
        message: "文档已加密，暂不支持",
      });
      expect(await readdir(ctx.tmpDir)).toEqual([]);
    });
    it.each(["garbage", "%PDF-1.7\ngarbage encrypted /Encrypt 1 0 R"])(
      "rejects invalid PDF %s",
      async (data) => {
        const input = path.join(dir, "bad.pdf");
        await writeFile(input, data);
        const runner = new PdfRenderRunner({
          location: await resolvePdfRender({ vendorDir }),
        });
        await expect(
          createPdfConverter(runner).convert(
            { path: input, name: "bad.pdf" },
            new MemorySpool(),
            ctx,
          ),
        ).rejects.toMatchObject({ code: "E_INVALID" });
        expect(await readdir(ctx.tmpDir)).toEqual([]);
      },
    );
  },
);
it("CLI converts and inspects text", async () => {
  const input = path.join(dir, "in.txt"),
    output = path.join(dir, "out.tdp");
  await writeFile(input, "# 你好\nCLI");
  const cli = path.resolve(import.meta.dirname, "../../bin/docpipe.mjs");
  const convert = await promisify(execFile)(process.execPath, [
    cli,
    "convert",
    input,
    output,
  ]);
  expect(JSON.parse(convert.stdout).units).toBe(1);
  const inspect = await promisify(execFile)(process.execPath, [
    cli,
    "inspect",
    output,
  ]);
  expect(JSON.parse(inspect.stdout).kind).toBe("flow");
  expect((await readFile(output)).length).toBeGreaterThan(12);
});

it("direct converter failures are Chinese AppErrors with private diagnostics", async () => {
  await expect(
    createTextConverter().convert(
      { path: path.join(dir, "missing"), name: "missing.txt" },
      new MemorySpool(),
      ctx,
    ),
  ).rejects.toMatchObject({ code: "E_NOT_FOUND", message: "文档不存在" });
  const input = path.join(dir, "in.txt");
  await writeFile(input, "hello");
  await expect(
    createTextConverter().convert(
      { path: input, name: "in.txt" },
      {
        write: async () => {
          throw new Error("private sink failure");
        },
      },
      ctx,
    ),
  ).rejects.toMatchObject({
    code: "E_INTERNAL",
    message: "文档转换失败",
    data: { cause: "Error: private sink failure" },
  });
});
