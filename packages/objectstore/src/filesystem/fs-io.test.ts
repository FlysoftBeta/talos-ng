import { expect, it, vi } from "vitest";
import type { FileHandle } from "node:fs/promises";
import { writeBytes } from "./fs-io.ts";
import { createStore } from "../lifecycle/store.ts";
import type { Backend } from "../lifecycle/store.ts";
import { deferred } from "@talos/base";

it("finishes short writes using the exact remaining buffer and file offsets", async () => {
  const output = new Uint8Array(10);
  const write = vi.fn(
    async (
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number,
    ) => {
      const bytesWritten = Math.min(2, length);
      output.set(buffer.subarray(offset, offset + bytesWritten), position);
      return { bytesWritten };
    },
  );
  await writeBytes(
    { write } as unknown as FileHandle,
    Uint8Array.of(1, 2, 3, 4, 5),
    3,
  );
  expect(output).toEqual(Uint8Array.of(0, 0, 0, 1, 2, 3, 4, 5, 0, 0));
  expect(write.mock.calls.map((call) => call.slice(1))).toEqual([
    [0, 5, 3],
    [2, 3, 5],
    [4, 1, 7],
  ]);
});

it("fails cleanly if a write makes no progress", async () => {
  const write = vi.fn(async () => ({ bytesWritten: 0 }));
  await expect(
    writeBytes({ write } as unknown as FileHandle, Uint8Array.of(1), 0),
  ).rejects.toMatchObject({ code: "E_INTERNAL" });
  expect(write).toHaveBeenCalledTimes(1);
});

it("all concurrent close callers wait for the underlying handle to close", async () => {
  const finished = deferred<void>();
  const close = vi.fn(() => finished.promise);
  const store = createStore({
    async open() {
      return {
        size: 0,
        async read() {
          return new Uint8Array();
        },
        close,
      };
    },
  } as unknown as Backend);
  const reader = await store.open("a".repeat(64));
  let closed = false;
  const first = reader.close(),
    second = reader.close().then(() => {
      closed = true;
    });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(close).toHaveBeenCalledTimes(1);
  finished.resolve();
  await Promise.all([first, second]);
  expect(closed).toBe(true);
});
