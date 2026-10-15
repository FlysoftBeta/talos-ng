import { describe, expect, it } from "vitest";
import { utf8Encode } from "@talos/base";
import { MemorySpool, PackReader, PackWriter } from "@talos/docpack";
import { openDocument } from "./resources.ts";
import type { DocumentSessionPort } from "./resources.ts";
import type { OpenDocument } from "./resources.ts";
const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
async function fixture(): Promise<{ bytes: Uint8Array; opened: OpenDocument }> {
  const sink = new MemorySpool(),
    writer = new PackWriter(sink, new MemorySpool(), { kind: "flow" });
  const rid = await writer.addResource(utf8Encode("离线正文"), "text/plain");
  writer.addUnit({ id: "text", entry: rid, deps: [], chars: 4 });
  await writer.finish();
  const pack = { id: "a".repeat(64), size: sink.size };
  return {
    bytes: await sink.read(0, sink.size),
    opened: {
      document: {
        id,
        title: "离线文档",
        owner: id,
        created: 1,
        kind: "flow",
        status: "ready",
        pack,
        units: 1,
        chars: 4,
      },
      pack,
      download: { url: "/dl/test", ticket: "test", expires: 100000 },
      manifest: (await PackReader.open(sink)).clientManifest(),
    },
  };
}
describe("document transport and offline access", () => {
  it("opens an owned complete retained pack fully offline", async () => {
    const { bytes, opened } = await fixture();
    const runtime = {
      getSnapshot: () => ({ user: { id } }),
      getLocal: async () => opened,
      can: () => ({ ok: false }),
      hasFile: async () => true,
      readFileRange: async (_rid: string, start: number, end: number) =>
        bytes.slice(start, end),
    } as unknown as DocumentSessionPort;
    const resources = await openDocument(runtime, id);
    expect((await resources.unit(opened.manifest.units[0]!)).text).toBe(
      "离线正文",
    );
  });
  it("distinguishes metadata cache from a complete offline pack", async () => {
    const { opened } = await fixture();
    const runtime = {
      getLocal: async () => opened,
      getSnapshot: () => ({ user: { id } }),
      can: () => ({ ok: false }),
      hasFile: async () => false,
    } as unknown as DocumentSessionPort;
    await expect(openDocument(runtime, id)).rejects.toMatchObject({
      code: "E_UNAVAILABLE",
      message: "离线未缓存",
    });
  });
});
