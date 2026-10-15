import { describe, expect, it } from "vitest";
import { AppError, utf8Encode } from "@talos/base";
import { MemorySpool, PackReader, PackWriter } from "@talos/docpack";
import { describeDocument } from "./documents.ts";
import type { DocumentReadPort, OpenDocument } from "./documents.ts";

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
describe("document metadata transport", () => {
  it("falls back from oversized RPC metadata to ranged PackReader manifest", async () => {
    const { bytes, opened } = await fixture();
    const calls: string[] = [];
    const { manifest, ...descriptor } = opened;
    const runtime = {
      getSnapshot: () => ({ user: { id } }),
      can: () => ({ ok: true }),
      readFileRange: async () => undefined,
      fetchRange: async (_url: string, start: number, end: number) => ({
        status: 206,
        contentRange: `bytes ${start}-${end}/${bytes.length}`,
        bytes: bytes.slice(start, end + 1),
      }),
      command: async (method: { name: string }) => {
        calls.push(method.name);
        if (method.name === "library.doc.open")
          throw new AppError("E_TOO_LARGE", "索引过大");
        return descriptor;
      },
    } as unknown as DocumentReadPort;
    expect((await describeDocument(runtime, id)).manifest).toEqual(manifest);
    expect(calls).toEqual(["library.doc.open", "library.doc.describe"]);
  });
  it("rejects a server ignoring byte ranges", async () => {
    const { opened } = await fixture();
    const descriptor = {
      document: opened.document,
      pack: opened.pack,
      download: opened.download,
    };
    const runtime = {
      getSnapshot: () => ({ user: { id } }),
      can: () => ({ ok: true }),
      readFileRange: async () => undefined,
      fetchRange: async () => ({
        status: 200,
        contentRange: null,
        bytes: new Uint8Array(0),
      }),
      command: async (method: { name: string }) => {
        if (method.name === "library.doc.open")
          throw new AppError("E_TOO_LARGE", "索引过大");
        return descriptor;
      },
    } as unknown as DocumentReadPort;
    await expect(describeDocument(runtime, id)).rejects.toMatchObject({
      code: "E_UNAVAILABLE",
    });
  });
});
