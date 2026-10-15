import { describe, expect, it, vi } from "vitest";
import { utf8Encode } from "@talos/base";
import { attachmentError, importDocument } from "./import.ts";
import type { ImportPort, ImportSource } from "./import.ts";

function port(
  handler: (
    name: string,
    args: { offset: number },
    body?: Uint8Array,
  ) => unknown,
) {
  const calls: string[] = [];
  const downloads: unknown[] = [];
  const value = {
    operation: () => ({ op: "o1" }),
    setDownload: (_id: string, v: unknown) => downloads.push(v),
    command: vi.fn(
      async (
        m: { name: string },
        args: { offset: number },
        o?: { body?: Uint8Array },
      ) => {
        calls.push(m.name);
        return handler(m.name, args, o?.body);
      },
    ),
  } as unknown as ImportPort;
  return { value, calls, downloads };
}
describe("document import", () => {
  it("sends short text in one command", async () => {
    const p = port(() => ({}));
    await importDocument(p.value, { title: "t", body: "正文" });
    expect(p.calls).toEqual(["library.doc.importText"]);
    expect(p.downloads.at(-1)).toBeUndefined();
  });
  it("resumes a partially stored upload from the server's offset", async () => {
    const bytes = new Uint8Array(300 * 1024);
    const source: ImportSource = {
      name: "a.pdf",
      size: bytes.length,
      read: async (s, e) => bytes.slice(s, e),
    };
    const sizes: number[] = [];
    const p = port((name, args, body) => {
      if (name === "upload.begin") return { id: "u", offset: 256 * 1024 };
      if (name === "upload.append") {
        sizes.push(body!.length);
        return { offset: args.offset + body!.length };
      }
      return {};
    });
    await importDocument(p.value, { title: "t", body: "", source });
    expect(sizes).toEqual([300 * 1024 - 256 * 1024]);
    expect(p.calls.slice(-2)).toEqual([
      "upload.commit",
      "library.doc.importFile",
    ]);
  });
  it("uploads large pasted text through the binary path", async () => {
    const body = "汉".repeat(30000);
    const p = port((name, args, b) =>
      name === "upload.begin"
        ? { id: "u", offset: 0 }
        : name === "upload.append"
          ? { offset: args.offset + b!.length }
          : {},
    );
    await importDocument(p.value, { title: "长文", body });
    expect(p.calls[0]).toBe("upload.begin");
    expect(p.calls).toContain("library.doc.importFile");
    expect(utf8Encode(body).length).toBeGreaterThan(64 * 1024);
  });
  it("keeps failures visible in the status list and limits attachment size", async () => {
    const p = port(() => {
      throw new Error("服务器拒绝");
    });
    await importDocument(p.value, { title: "t", body: "x" });
    expect(p.downloads.at(-1)).toMatchObject({ error: "服务器拒绝" });
    expect(attachmentError(201 * 1024 * 1024)).toBe("文档不能超过 200 MiB");
    expect(attachmentError(1)).toBeUndefined();
  });
});
