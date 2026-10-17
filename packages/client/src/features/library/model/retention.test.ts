import { beforeEach, expect, it, vi } from "vitest";
import { AppError } from "@talos/base";
import { RetentionScheduler } from "./retention.ts";
import type { RetentionPort } from "./retention.ts";
import type { LibraryData } from "./library-data.ts";

const state = vi.hoisted(() => ({
  user: "first",
  status: vi.fn(),
  getLocal: vi.fn(),
  download: vi.fn(),
}));
const fixture = {
  id: "document",
  title: "Private title",
  status: "ready",
  pack: { id: "a".repeat(64), size: 100 },
};
const data = {
  docs: [fixture],
  retentions: new Map([
    [
      fixture.id,
      {
        id: fixture.id,
        kind: "doc",
        value: { v: 7, t: { ms: 0 } },
        lastUsed: 0,
      },
    ],
  ]),
  states: new Map(),
  collections: [],
  rows: [],
} as unknown as LibraryData;
const port = {
  getSnapshot: () => ({ user: { id: state.user } }),
  getLocal: state.getLocal,
  setLocal: async () => {},
  collectFiles: async () => {},
  releaseFiles: async () => {},
  hasFile: async () => false,
  can: () => ({ ok: true }),
  time: () => 1,
  setTransfer: state.status,
  downloadFile: state.download,
  delay: () => 0,
  clearDelay: () => {},
  command: async () => ({
    document: fixture,
    pack: fixture.pack,
    download: { url: "/dl/test" },
  }),
  readFileRange: async () => undefined,
  fetchRange: async () => {
    throw new Error("unused");
  },
} as unknown as RetentionPort;
beforeEach(() => {
  state.user = "first";
  state.status.mockReset();
  state.getLocal.mockReset().mockResolvedValue([]);
  state.download.mockReset();
});
it("drops late progress and cancellation errors after the account changes", async () => {
  let progress: ((written: number, total: number) => void) | undefined;
  let rejectDownload: (error: unknown) => void = () => {};
  let started: () => void = () => {};
  const begin = new Promise<void>((resolve) => {
    started = resolve;
  });
  state.download.mockImplementation(
    (
      _rid: string,
      _size: number,
      _url: string,
      _owner: string,
      callback: (written: number, total: number) => void,
    ) => {
      progress = callback;
      started();
      return new Promise<void>((_resolve, reject) => {
        rejectDownload = reject;
      });
    },
  );
  new RetentionScheduler(port).update({ user: "first", active: true, data });
  await begin;
  expect(state.status).toHaveBeenCalledWith("library:document", {
    title: "Private title",
    progress: 0,
  });
  state.status.mockClear();
  state.user = "second";
  progress!(50, 100);
  rejectDownload(new AppError("E_CANCELLED", "旧会话请求已取消"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(state.status).not.toHaveBeenCalled();
});
it("drops a late outer retention failure after the account changes", async () => {
  let rejectRead: (error: unknown) => void = () => {};
  let started: () => void = () => {};
  const begin = new Promise<void>((resolve) => {
    started = resolve;
  });
  state.getLocal.mockImplementation(() => {
    started();
    return new Promise<void>((_resolve, reject) => {
      rejectRead = reject;
    });
  });
  new RetentionScheduler(port).update({ user: "first", active: true, data });
  await begin;
  state.user = "second";
  rejectRead(new AppError("E_UNAVAILABLE", "旧账户读取失败"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(state.status).not.toHaveBeenCalled();
});
