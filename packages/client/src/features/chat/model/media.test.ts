// @vitest-environment node
import { expect, it, vi } from "vitest";
import { contract, CHAT_IMAGE_LIMIT } from "@talos/contract";
import type { ChatFile, ChatSticker } from "@talos/contract";
import { CachedImageController, StickerController } from "./media.ts";
import { uploadImage } from "./upload.ts";
import type { MediaPort } from "./ports.ts";
import { fileBytes } from "./commands.ts";
vi.mock("./commands.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./commands.ts")>()),
  fileBytes: vi.fn(),
}));
const file: ChatFile = {
  rid: "a".repeat(64),
  size: 1,
  mime: "image/png",
  width: 1,
  height: 1,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("releases display URLs on replacement/unmount and ignores late image reads", async () => {
  const first = deferred<Uint8Array>(),
    urls = { create: vi.fn(() => "blob:image"), release: vi.fn() };
  vi.mocked(fileBytes)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(new Uint8Array(1));
  const model = new CachedImageController(
    { can: () => ({ ok: true }) } as unknown as MediaPort,
    urls,
    file,
  );
  model.load();
  model.load();
  await Promise.resolve();
  expect(model.getState().src).toBe("blob:image");
  first.resolve(new Uint8Array(2));
  await first.promise;
  expect(urls.create).toHaveBeenCalledTimes(1);
  model.dispose();
  model.dispose();
  expect(urls.release).toHaveBeenCalledExactlyOnceWith("blob:image");
});
it("uploads resumed chunks before commit and post, and aborts after an interrupted append", async () => {
  const calls: string[] = [],
    offsets: number[] = [],
    progress: number[] = [];
  const runtime = {
    operation: () => ({ op: "post" }),
    can: () => ({ ok: true }),
    command: vi.fn(
      async (method: { name: string }, args: { offset?: number }) => {
        calls.push(method.name);
        if (args.offset !== undefined) offsets.push(args.offset);
        return method === contract.upload.begin
          ? { id: "upload", offset: 1 }
          : {};
      },
    ),
  };
  const source = { size: 300000, read: async () => new Uint8Array(300000) };
  await uploadImage(
    runtime as unknown as MediaPort,
    "group",
    source,
    (n) => progress.push(n),
    "reply",
  );
  expect(offsets).toEqual([1, 262145]);
  expect(progress.at(-1)).toBe(1);
  expect(calls).toEqual([
    contract.upload.begin.name,
    contract.upload.append.name,
    contract.upload.append.name,
    contract.upload.commit.name,
    contract.chat.post.image.name,
  ]);
  runtime.command.mockImplementation(async (method) => {
    if (method === contract.upload.begin) return { id: "upload", offset: 0 };
    if (method === contract.upload.append) throw new Error("interrupted");
    return {};
  });
  await expect(
    uploadImage(runtime as unknown as MediaPort, "group", source, () => {}),
  ).rejects.toThrow("interrupted");
  expect(runtime.command).toHaveBeenLastCalledWith(contract.upload.abort, {
    id: "upload",
  });
  const read = vi.fn();
  await expect(
    uploadImage(
      runtime as unknown as MediaPort,
      "group",
      { size: CHAT_IMAGE_LIMIT + 1, read },
      () => {},
    ),
  ).rejects.toThrow("12 MiB");
  expect(read).not.toHaveBeenCalled();
});
it("stops sticker pagination on close and saves recents only after the send succeeds", async () => {
  const pending = deferred<{ stickers: ChatSticker[]; next: number | null }>();
  const runtime = {
    can: () => ({ ok: true }),
    getLocal: vi.fn(async () => undefined),
    setLocal: vi.fn(),
    command: vi.fn(() => pending.promise),
  };
  const model = new StickerController(runtime as unknown as MediaPort);
  model.update(true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  model.dispose();
  pending.resolve({ stickers: [], next: 100 });
  await pending.promise;
  await Promise.resolve();
  expect(runtime.command).toHaveBeenCalledTimes(1);
  expect(runtime.setLocal).not.toHaveBeenCalled();
  const sticker = { id: "sticker", pack: "pack", name: "one", file },
    close = vi.fn();
  await model.pick(
    sticker,
    async () => {
      throw new Error("send failed");
    },
    close,
  );
  expect(runtime.setLocal).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  await model.pick(sticker, async () => {}, close);
  expect(runtime.setLocal).toHaveBeenCalledWith("recent-stickers", ["sticker"]);
  expect(close).toHaveBeenCalledOnce();
});
