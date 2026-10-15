import { describe, expect, it, vi } from "vitest";
import { utf8Encode } from "@talos/base";
import {
  MemorySpool,
  PackReader,
  PackWriter,
  encodeResourceBatch,
} from "@talos/docpack";
import { DocumentResources, estimateUnit, openDocument } from "./resources.ts";
import type { DocumentSessionPort, OpenDocument } from "./resources.ts";

const docId = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
async function pagedFixture() {
  const sink = new MemorySpool();
  const writer = new PackWriter(sink, new MemorySpool(), { kind: "paged" });
  const entry = await writer.addResource(utf8Encode("<p>页</p>"), "text/html");
  const shared = await writer.addResource(utf8Encode("body{}"), "text/css");
  const dep = await writer.addResource(utf8Encode("png"), "image/png");
  const unused = await writer.addResource(utf8Encode("zzz"), "image/png");
  writer.addUnit({ id: "p1", entry, deps: [dep, shared], w: 600, h: 800 });
  await writer.finish();
  const manifest = (await PackReader.open(sink)).clientManifest();
  const pack = { id: "b".repeat(64), size: sink.size };
  const opened = {
    document: {
      id: docId,
      title: "t",
      owner: docId,
      created: 1,
      kind: "paged",
      status: "ready",
      pack,
      units: 1,
      chars: 0,
    },
    pack,
    download: { url: "/dl", ticket: "t", expires: 1 },
    manifest,
  } as unknown as OpenDocument;
  return { opened, entry, shared, dep, unused };
}
function port(extra: Partial<Record<keyof DocumentSessionPort, unknown>> = {}) {
  return {
    getSnapshot: () => ({ user: { id: docId } }),
    can: () => ({ ok: true }),
    fetchBody: vi.fn(),
    hasFile: async () => false,
    ...extra,
  } as unknown as DocumentSessionPort;
}

describe("document resources", () => {
  it("fetches a small resource from the server when the pack is not retained", async () => {
    const { opened, entry } = await pagedFixture();
    const bytes = utf8Encode("<p>页</p>");
    const fetchBody = vi.fn(async () => ({
      body: encodeResourceBatch([{ rid: entry, enc: "raw", bytes }]),
    }));
    const resources = new DocumentResources(port({ fetchBody }), opened, false);
    expect([...(await resources.resource(entry))]).toEqual([...bytes]);
    expect(fetchBody).toHaveBeenCalledWith(expect.anything(), {
      doc: docId,
      rids: [entry],
    });
  });

  it("reports an incomplete batch as an integrity failure and an unknown rid as missing", async () => {
    const { opened, entry } = await pagedFixture();
    const fetchBody = vi.fn(async () => ({ body: encodeResourceBatch([]) }));
    const resources = new DocumentResources(port({ fetchBody }), opened, false);
    await expect(resources.resource(entry)).rejects.toMatchObject({
      code: "E_INTEGRITY",
    });
    await expect(resources.resource("f".repeat(64))).rejects.toMatchObject({
      code: "E_INTEGRITY",
    });
  });

  it("refuses an uncached small resource offline", async () => {
    const { opened, entry } = await pagedFixture();
    const resources = new DocumentResources(
      port({ can: () => ({ ok: false }) }),
      opened,
      false,
    );
    await expect(resources.resource(entry)).rejects.toMatchObject({
      code: "E_UNAVAILABLE",
    });
  });

  it("a unit carries its entry text plus unique dependency resources, never the entry twice", async () => {
    const { opened, entry, shared, dep } = await pagedFixture();
    const raw: Record<string, Uint8Array> = {
      [entry]: utf8Encode("<p>页</p>"),
      [shared]: utf8Encode("body{}"),
      [dep]: utf8Encode("png"),
    };
    const fetchBody = vi.fn(async (_m: unknown, args: { rids: string[] }) => ({
      body: encodeResourceBatch(
        args.rids.map((rid) => ({
          rid,
          enc: "raw" as const,
          bytes: raw[rid]!,
        })),
      ),
    }));
    const resources = new DocumentResources(port({ fetchBody }), opened, false);
    const unit = await resources.unit(opened.manifest.units[0]!);
    expect(unit.text).toBe("<p>页</p>");
    const ids = unit.resources.map((r) => r.rid);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(entry);
    expect(ids).toContain(dep);
    expect(unit.resources.find((r) => r.rid === dep)!.mime).toBe("image/png");
  });

  it("stops between resources when the page leaves the reading window", async () => {
    const { opened, entry } = await pagedFixture();
    const controller = new AbortController();
    const fetchBody = vi.fn(async (_m: unknown, args: { rids: string[] }) => {
      controller.abort();
      return {
        body: encodeResourceBatch(
          args.rids.map((rid) => ({
            rid,
            enc: "raw" as const,
            bytes: utf8Encode("<p>页</p>"),
          })),
        ),
      };
    });
    const resources = new DocumentResources(port({ fetchBody }), opened, false);
    await expect(
      resources.unit(opened.manifest.units[0]!, controller.signal),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(fetchBody).toHaveBeenCalledTimes(1);
    const pre = new AbortController();
    pre.abort();
    await expect(
      resources.unit(opened.manifest.units[0]!, pre.signal),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(entry).toBeTruthy();
  });
});

describe("opening a document", () => {
  it("caches the described document and detects retention", async () => {
    const { opened } = await pagedFixture();
    const local = new Map<string, unknown>();
    const runtime = port({
      getLocal: async (k: string) => local.get(k),
      setLocal: async (k: string, v: unknown) => void local.set(k, v),
      command: vi.fn(async () => opened),
      hasFile: async () => true,
    });
    const spy = vi
      .spyOn(await import("../../library/index.ts"), "describeDocument")
      .mockResolvedValue(opened);
    try {
      const resources = await openDocument(runtime, docId);
      expect(resources.document).toBe(opened);
      expect(local.size).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("abandons an open that finished after the account changed", async () => {
    const { opened } = await pagedFixture();
    let user = docId;
    const runtime = port({
      getSnapshot: () => ({ user: { id: user } }),
      getLocal: async () => undefined,
      setLocal: vi.fn(),
    });
    const spy = vi
      .spyOn(await import("../../library/index.ts"), "describeDocument")
      .mockImplementation(async () => {
        user = "someone-else";
        return opened;
      });
    try {
      await expect(openDocument(runtime, docId)).rejects.toMatchObject({
        code: "E_CANCELLED",
      });
      expect(
        (runtime as unknown as { setLocal: ReturnType<typeof vi.fn> }).setLocal,
      ).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("page height estimates", () => {
  const paged = { kind: "paged" } as never;
  const flow = { kind: "flow" } as never;
  it("scales paged units by fit width or a numeric zoom, with a floor on narrow screens", () => {
    expect(estimateUnit(paged, { w: 600, h: 800 } as never, 632, "fit")).toBe(
      800 + 24,
    );
    expect(estimateUnit(paged, { w: 600, h: 800 } as never, 332, "fit")).toBe(
      Math.ceil(800 * (300 / 600)) + 24,
    );
    expect(estimateUnit(paged, { w: 600, h: 800 } as never, 10, "fit")).toBe(
      Math.ceil(800 * (100 / 600)) + 24,
    );
    expect(estimateUnit(paged, { w: 600, h: 800 } as never, 999, "1.5")).toBe(
      1200 + 24,
    );
    expect(estimateUnit(paged, {} as never, 782, "fit")).toBe(1000 + 24);
  });
  it("estimates flowing text from characters per line with a minimum height", () => {
    expect(estimateUnit(flow, { chars: 0 } as never, 400, "fit")).toBe(80);
    const narrow = estimateUnit(flow, { chars: 8000 } as never, 100, "fit");
    const wide = estimateUnit(flow, { chars: 8000 } as never, 1200, "fit");
    expect(narrow).toBeGreaterThan(wide);
    expect(wide).toBeGreaterThanOrEqual(80);
  });
});
