import { describe, expect, it } from "vitest";
import { AppError } from "@talos/base";
import type { FileWriter } from "@talos/store";
import { fetchFileRanges } from "./ranged-download.ts";

function writer(
  initial = 0,
): FileWriter & { committed: boolean; chunks: number[] } {
  return {
    written: initial,
    committed: false,
    chunks: [],
    async append(bytes) {
      this.chunks.push(bytes.byteLength);
      Object.assign(this, { written: this.written + bytes.byteLength });
    },
    async commit() {
      this.committed = true;
    },
    async close() {},
  };
}
function delivery(
  size: number,
  options: { status?: number; extra?: number; cancel?: () => void } = {},
): typeof fetch {
  return (async (_url: unknown, init: RequestInit) => {
    const range = (init.headers as Record<string, string>)["Range"]!;
    const match = /bytes=(\d+)-(\d+)/.exec(range)!;
    const start = Number(match[1]),
      end = Number(match[2]);
    let read = false;
    return {
      status: options.status ?? 206,
      headers: { get: () => `bytes ${start}-${end}/${size}` },
      body: {
        cancel: async () => options.cancel?.(),
        getReader: () => ({
          async read() {
            if (read) return { done: true };
            read = true;
            return {
              done: false,
              value: new Uint8Array(end - start + 1 + (options.extra ?? 0)),
            };
          },
          cancel: async () => options.cancel?.(),
          releaseLock() {},
        }),
      },
    };
  }) as unknown as typeof fetch;
}
describe("ranged file download", () => {
  it("resumes at the durable offset and bounds each request to one MiB", async () => {
    const output = writer(512);
    await fetchFileRanges({
      url: "/dl/ticket",
      size: 2_100_000,
      writer: output,
      fetch: delivery(2_100_000),
      assertActive() {},
    });
    expect(output.written).toBe(2_100_000);
    expect(Math.max(...output.chunks)).toBe(1024 * 1024);
    expect(output.committed).toBe(true);
  });
  it.each([200, 403, 416])(
    "rejects HTTP %s without appending",
    async (status) => {
      const output = writer();
      await expect(
        fetchFileRanges({
          url: "/dl/ticket",
          size: 12,
          writer: output,
          fetch: delivery(12, { status }),
          assertActive() {},
        }),
      ).rejects.toMatchObject({ code: "E_PROTOCOL" });
      expect(output.written).toBe(0);
    },
  );
  it.each([-1, 1])("rejects wrong response length (%s)", async (extra) => {
    const output = writer();
    await expect(
      fetchFileRanges({
        url: "/dl/ticket",
        size: 12,
        writer: output,
        fetch: delivery(12, { extra }),
        assertActive() {},
      }),
    ).rejects.toMatchObject({ code: "E_PROTOCOL" });
    expect(output.committed).toBe(false);
  });
  it("fences session changes before saving bytes", async () => {
    const output = writer();
    let checks = 0;
    await expect(
      fetchFileRanges({
        url: "/dl/ticket",
        size: 12,
        writer: output,
        fetch: delivery(12),
        assertActive() {
          if (++checks === 3) throw new AppError("E_CANCELLED", "expired");
        },
      }),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(output.written).toBe(0);
  });
});
