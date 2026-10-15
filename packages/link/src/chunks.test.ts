import { describe, expect, it, vi } from "vitest";
import { AppError, deferred } from "@talos/base";
import type { Deferred } from "@talos/base";
import type { Call, CallOptions, CallResult } from "./client.ts";
import { downloadChunks, uploadChunks } from "./chunks.ts";
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function peer() {
  const requests: {
    offset: number;
    length: number;
    options?: CallOptions;
    result: Deferred<CallResult>;
  }[] = [];
  const call: Call = (_method, args, options) => {
    const { offset, length } = args as { offset: number; length: number };
    const result = deferred<CallResult>();
    requests.push({ offset, length, options, result });
    return result.promise;
  };
  const reply = (index: number) => {
    const request = requests[index]!;
    request.result.resolve({
      data: null,
      body: new Uint8Array(request.length).fill(request.offset),
    });
  };
  return { call, requests, reply };
}
describe("chunk pumps", () => {
  it("bounds upload concurrency, sends ordered offsets, reports only contiguous progress and resumes", async () => {
    const { call, requests, reply } = peer();
    const progress = vi.fn();
    const read = vi.fn((offset: number, length: number) =>
      new Uint8Array(length).fill(offset),
    );
    const result = uploadChunks(call, {
      size: 20,
      startOffset: 2,
      chunkSize: 4,
      window: 3,
      method: "append",
      read,
      onProgress: progress,
    });
    await flush();
    expect(requests.map((r) => r.offset)).toEqual([2, 6, 10]);
    expect(requests[1]!.options?.body).toEqual(new Uint8Array(4).fill(6));
    reply(2);
    reply(1);
    await flush();
    expect(progress).not.toHaveBeenCalled();
    expect(requests).toHaveLength(3);
    reply(0);
    await flush();
    expect(requests.map((r) => r.offset)).toEqual([2, 6, 10, 14, 18]);
    reply(4);
    reply(3);
    expect(await result).toBe(20);
    expect(progress.mock.calls).toEqual([
      [6, 20],
      [10, 20],
      [14, 20],
      [18, 20],
      [20, 20],
    ]);
    expect(read.mock.calls).toEqual([
      [2, 4],
      [6, 4],
      [10, 4],
      [14, 4],
      [18, 2],
    ]);
  });
  it("downloads concurrently but writes strictly in order, awaiting each sink write", async () => {
    const { call, requests, reply } = peer();
    const gate = deferred<void>();
    const writes: number[] = [];
    const result = downloadChunks(call, {
      size: 8,
      chunkSize: 2,
      method: "read",
      write: async (offset, body) => {
        writes.push(offset);
        expect(body).toEqual(new Uint8Array(2).fill(offset));
        if (offset === 0) await gate.promise;
      },
    });
    await flush();
    reply(2);
    reply(1);
    reply(0);
    await flush();
    expect(writes).toEqual([0]);
    expect(requests).toHaveLength(3);
    gate.resolve();
    await flush();
    expect(writes).toEqual([0, 2, 4]);
    reply(3);
    expect(await result).toBe(8);
    expect(writes).toEqual([0, 2, 4, 6]);
  });
  it("cancels all outstanding calls promptly and stops new reads", async () => {
    const { call, requests } = peer();
    const abort = new AbortController();
    const read = vi.fn(
      (_offset: number, length: number) => new Uint8Array(length),
    );
    const result = uploadChunks(call, {
      size: 100,
      chunkSize: 10,
      method: "append",
      read,
      signal: abort.signal,
    });
    const check = expect(result).rejects.toMatchObject({ code: "E_CANCELLED" });
    await flush();
    abort.abort();
    await check;
    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.options?.signal?.aborted)).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
    for (const request of requests)
      request.result.reject(new AppError("E_CANCELLED", "cancelled"));
    await flush();
  });
  it("cancels a stalled local read and cleans external listeners", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const call = vi.fn<Call>();
    const result = uploadChunks(call, {
      size: 1,
      method: "m",
      signal: controller.signal,
      read: () => new Promise(() => {}),
    });
    const check = expect(result).rejects.toMatchObject({ code: "E_CANCELLED" });
    await flush();
    controller.abort();
    await check;
    expect(remove).toHaveBeenCalledOnce();
    expect(call).not.toHaveBeenCalled();
  });
  it("fails promptly on an out-of-order error and aborts sibling calls without retries", async () => {
    const { call, requests } = peer();
    const result = downloadChunks(call, {
      size: 100,
      chunkSize: 10,
      method: "read",
      write: () => {},
    });
    const check = expect(result).rejects.toMatchObject({
      code: "E_DISCONNECTED",
    });
    await flush();
    requests[2]!.result.reject(new AppError("E_DISCONNECTED", "lost"));
    await check;
    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.options?.signal?.aborted)).toBe(true);
  });
  it("checks upload/download chunk sizes", async () => {
    const call: Call = async () => ({ data: null, body: new Uint8Array(0) });
    await expect(
      uploadChunks(call, {
        size: 1,
        method: "m",
        read: () => new Uint8Array(0),
      }),
    ).rejects.toMatchObject({ code: "E_INTEGRITY" });
    await expect(
      downloadChunks(call, { size: 1, method: "m", write: () => {} }),
    ).rejects.toMatchObject({ code: "E_INTEGRITY" });
  });
  it("supports custom argument builders and zero-byte/already-completed transfers", async () => {
    const call = vi.fn<Call>(async () => ({
      data: null,
      body: new Uint8Array(0),
    }));
    expect(
      await uploadChunks(call, {
        size: 0,
        method: "m",
        read: () => new Uint8Array(0),
      }),
    ).toBe(0);
    expect(
      await downloadChunks(call, {
        size: 42,
        startOffset: 42,
        method: "m",
        write: () => {},
      }),
    ).toBe(42);
    expect(call).not.toHaveBeenCalled();
    await uploadChunks(call, {
      size: 3,
      method: "custom.append",
      args: (offset, length) => ({ transferId: "id", at: offset, n: length }),
      read: () => new Uint8Array(3),
    });
    expect(call).toHaveBeenCalledWith(
      "custom.append",
      { transferId: "id", at: 0, n: 3 },
      expect.objectContaining({ body: new Uint8Array(3) }),
    );
  });
  it.each([
    { size: -1 },
    { size: 1.5 },
    { startOffset: 11 },
    { startOffset: -1 },
    { chunkSize: 0 },
    { chunkSize: 524289 },
    { window: 0 },
    { window: 1.5 },
    { method: "" },
  ])("rejects invalid parameters %j", async (invalid) => {
    await expect(
      uploadChunks(vi.fn<Call>(), {
        size: 10,
        method: "m",
        read: () => new Uint8Array(0),
        ...invalid,
      }),
    ).rejects.toMatchObject({ code: "E_INVALID" });
  });
  it("cancels before starting and wraps unexpected local failures", async () => {
    const abort = new AbortController();
    abort.abort();
    const call = vi.fn<Call>();
    await expect(
      downloadChunks(call, {
        size: 0,
        method: "m",
        signal: abort.signal,
        write: () => {},
      }),
    ).rejects.toMatchObject({ code: "E_CANCELLED" });
    expect(call).not.toHaveBeenCalled();
    await expect(
      uploadChunks(call, {
        size: 1,
        method: "m",
        read: () => {
          throw new Error("secret");
        },
      }),
    ).rejects.toMatchObject({ code: "E_INTERNAL", message: "分块传输失败" });
  });
  it("property: random sizes, windows and resumes cover exactly the suffix in order", async () => {
    let seed = 123;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let trial = 0; trial < 100; trial++) {
      const size = random() % 1000;
      const startOffset = random() % (size + 1);
      const chunkSize = 1 + (random() % 100);
      const window = 1 + (random() % 8);
      const offsets: number[] = [];
      const call: Call = async (_method, args) => {
        const { offset, length } = args as { offset: number; length: number };
        return { data: null, body: new Uint8Array(length).fill(offset % 256) };
      };
      let expected = startOffset;
      expect(
        await downloadChunks(call, {
          size,
          startOffset,
          chunkSize,
          window,
          method: "read",
          write: (offset, bytes) => {
            expect(offset).toBe(expected);
            expected += bytes.length;
            offsets.push(offset);
          },
        }),
      ).toBe(size);
      expect(expected).toBe(size);
      expect(new Set(offsets).size).toBe(offsets.length);
    }
  });
});

it("preserves intentionally null custom chunk arguments", async () => {
  const call = vi.fn<Call>(async () => ({
    data: null,
    body: new Uint8Array(1),
  }));
  await downloadChunks(call, {
    size: 1,
    method: "next",
    args: () => null,
    write: () => {},
  });
  expect(call.mock.calls[0]![1]).toBe(null);
});
