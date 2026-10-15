import { describe, expect, it, vi } from "vitest";
import { AppError, sha256Hex, utf8Encode } from "@talos/base";
import { CHAT_TEXT_CHUNK, contract } from "@talos/contract";
import type { ChatPost, ChatFile } from "@talos/contract";
import type { CommandPort } from "./ports.ts";
import {
  draftBody,
  fileBytes,
  fullBody,
  onlineCall,
  sendText,
  setState,
  textSource,
} from "./commands.ts";
const id = "00000000000000000000000001",
  conversation = "00000000000000000000000002";
function fixture() {
  const local = new Map<string, unknown>();
  let seq = 1;
  const runtime = {
    operation: () => ({
      op: `0000000000000000000000${String(seq++).padStart(4, "0")}`,
      t: { ms: 100, counter: seq },
    }),
    getLocal: vi.fn(async (key: string) => local.get(key)),
    setLocal: vi.fn(async (key: string, value: unknown) => {
      local.set(key, value);
    }),
    command: vi.fn<(...args: unknown[]) => Promise<{ queued: string }>>(
      async () => ({ queued: id }),
    ),
    fetchBody: vi.fn(),
    readFile: vi.fn(async () => undefined),
    saveFile: vi.fn(),
    retainFile: vi.fn(),
    loadRows: vi.fn(),
  };
  return { runtime: runtime as unknown as CommandPort, mock: runtime, local };
}
function post(patch: Partial<ChatPost> = {}): ChatPost {
  return {
    id,
    conversation,
    seq: 1,
    rev: 1,
    author: id,
    authorName: "同学",
    kind: "text",
    preview: "预览",
    bodyLength: 1001,
    replyTo: null,
    created: 1,
    edited: null,
    deletedAt: null,
    sticker: null,
    image: null,
    ...patch,
  };
}
describe("chat commands and cache boundaries", () => {
  it("stores ordinary text as one queued fact with trim and reply identity", async () => {
    const { runtime, mock } = fixture();
    await sendText(runtime, conversation, "  消息\n ", id);
    expect(mock.command).toHaveBeenCalledWith(
      contract.chat.post.send,
      expect.objectContaining({ text: "消息", replyTo: id, kind: "text" }),
      expect.any(Object),
    );
  });
  it("rejects blank and oversized content before enqueuing", async () => {
    const { runtime, mock } = fixture();
    await expect(sendText(runtime, conversation, " \n ")).rejects.toMatchObject(
      { code: "E_INVALID" },
    );
    await expect(
      textSource(runtime, "文".repeat(5000001)),
    ).rejects.toMatchObject({ code: "E_TOO_LARGE" });
    expect(mock.command).not.toHaveBeenCalled();
  });
  it("queues long text chunks before the immutable reference in FIFO order", async () => {
    const { runtime, mock, local } = fixture();
    const text = "文".repeat(CHAT_TEXT_CHUNK * 2 + 1);
    await sendText(runtime, conversation, text);
    expect(mock.command.mock.calls.map((args) => args[0])).toEqual([
      contract.chat.text.put,
      contract.chat.text.put,
      contract.chat.text.put,
      contract.chat.post.send,
    ]);
    expect(local.size).toBe(2);
    expect(mock.command).toHaveBeenNthCalledWith(
      3,
      contract.chat.text.put,
      expect.objectContaining({
        offset: CHAT_TEXT_CHUNK * 2,
        total: text.length,
        text: "文",
      }),
    );
  });
  it("does not enqueue a send after chunk persistence failure", async () => {
    const { runtime, mock } = fixture();
    mock.command.mockRejectedValueOnce(
      new AppError("E_UNAVAILABLE", "存储已满"),
    );
    await expect(
      sendText(runtime, conversation, "文".repeat(CHAT_TEXT_CHUNK + 1)),
    ).rejects.toThrow("存储已满");
    expect(mock.command).toHaveBeenCalledTimes(1);
  });
  it("uses the same operation identity in durable LWW envelope and intent", async () => {
    const { runtime, mock } = fixture();
    await setState(runtime, conversation, "pin", true);
    expect(mock.command).toHaveBeenCalledWith(
      contract.chat.state.set,
      {
        conversation,
        key: "pin",
        value: { v: true, t: { ms: 100, counter: 2 }, op: id },
      },
      { op: id },
    );
  });
  it("reads short full bodies without a network call", async () => {
    const { runtime, mock } = fixture();
    expect(
      await fullBody(runtime, post({ preview: "正文", bodyLength: 2 })),
    ).toBe("正文");
    expect(mock.fetchBody).not.toHaveBeenCalled();
  });
  it("caches body bytes decoded across UTF8 chunk boundaries and invalidates edited bodies", async () => {
    const { runtime, mock } = fixture();
    const bytes = utf8Encode("长篇正文");
    mock.fetchBody
      .mockResolvedValueOnce({
        data: { eof: false },
        body: bytes.subarray(0, 2),
      })
      .mockResolvedValueOnce({ data: { eof: true }, body: bytes.subarray(2) });
    expect(await fullBody(runtime, post())).toBe("长篇正文");
    expect(await fullBody(runtime, post())).toBe("长篇正文");
    expect(mock.fetchBody).toHaveBeenCalledTimes(2);
    mock.fetchBody.mockResolvedValue({
      data: { eof: true },
      body: utf8Encode("修改后"),
    });
    expect(await fullBody(runtime, post({ edited: 2 }))).toBe("修改后");
  });
  it("does not loop indefinitely on an empty nonfinal body chunk", async () => {
    const { runtime, mock } = fixture();
    mock.fetchBody.mockResolvedValue({
      data: { eof: false },
      body: new Uint8Array(),
    });
    await expect(fullBody(runtime, post())).rejects.toMatchObject({
      code: "E_PROTOCOL",
    });
    expect(mock.fetchBody).toHaveBeenCalledTimes(1);
  });
  it("propagates offline missing-body state without overwriting existing cache", async () => {
    const { runtime, mock, local } = fixture();
    mock.fetchBody.mockRejectedValue(new AppError("E_OFFLINE", "离线未缓存"));
    await expect(fullBody(runtime, post())).rejects.toMatchObject({
      code: "E_OFFLINE",
    });
    expect(local.size).toBe(0);
  });
  it("reuses cached file bytes and attaches a retained owner", async () => {
    const { runtime, mock } = fixture();
    const bytes = utf8Encode("image");
    mock.readFile.mockResolvedValue(bytes as never);
    const file: ChatFile = {
      rid: sha256Hex(bytes),
      size: bytes.length,
      mime: "image/png",
      width: 1,
      height: 1,
    };
    expect(await fileBytes(runtime, file, conversation, "retained")).toBe(
      bytes,
    );
    expect(mock.retainFile).toHaveBeenCalledWith(file.rid, "retained");
    expect(mock.fetchBody).not.toHaveBeenCalled();
  });
  it("stores downloaded files through FileStore rather than Blob", async () => {
    const { runtime, mock } = fixture();
    const bytes = utf8Encode("image");
    const file: ChatFile = {
      rid: sha256Hex(bytes),
      size: bytes.length,
      mime: "image/png",
      width: 1,
      height: 1,
    };
    mock.fetchBody.mockResolvedValue({ data: { eof: true }, body: bytes });
    expect(
      Array.from(await fileBytes(runtime, file, conversation, "retained")),
    ).toEqual(Array.from(bytes));
    expect(mock.saveFile).toHaveBeenCalledWith(
      file.rid,
      expect.any(Uint8Array),
      "retained",
    );
    expect(Array.from(mock.saveFile.mock.calls[0]![1] as Uint8Array)).toEqual(
      Array.from(bytes),
    );
  });
  it("restores a remotely saved giant draft and then uses the local cache", async () => {
    const { runtime, mock } = fixture();
    mock.fetchBody.mockResolvedValue({
      data: { eof: true },
      body: utf8Encode("离线草稿"),
    });
    expect(await draftBody(runtime, id)).toBe("离线草稿");
    expect(await draftBody(runtime, id)).toBe("离线草稿");
    expect(mock.fetchBody).toHaveBeenCalledTimes(1);
  });
  it("rejects accidental queued calls at the online-result boundary", async () => {
    const { runtime } = fixture();
    await expect(
      onlineCall(runtime, contract.chat.sticker.list, {}),
    ).rejects.toMatchObject({ code: "E_INTERNAL" });
  });
});

describe("cache revisions", () => {
  it("distinguishes two edits with the same clock timestamp using row revisions", async () => {
    const { runtime, mock, local } = fixture();
    mock.fetchBody
      .mockResolvedValueOnce({
        data: { eof: true },
        body: utf8Encode("第一次编辑"),
      })
      .mockResolvedValueOnce({
        data: { eof: true },
        body: utf8Encode("第二次编辑"),
      });
    expect(await fullBody(runtime, post({ edited: 100, rev: 2 }))).toBe(
      "第一次编辑",
    );
    expect(await fullBody(runtime, post({ edited: 100, rev: 3 }))).toBe(
      "第二次编辑",
    );
    expect([...local.keys()]).toEqual([
      `conv:${conversation}:body:${id}:2`,
      `conv:${conversation}:body:${id}:3`,
    ]);
  });
  it("tags conversation images so a gone scope releases its cache", async () => {
    const { runtime, mock } = fixture();
    const bytes = utf8Encode("image");
    mock.readFile.mockResolvedValue(bytes as never);
    const file: ChatFile = {
      rid: sha256Hex(bytes),
      size: bytes.length,
      mime: "image/png",
      width: 1,
      height: 1,
    };
    await fileBytes(runtime, file, conversation);
    expect(mock.retainFile).toHaveBeenCalledWith(
      file.rid,
      `conv:${conversation}:cache`,
    );
  });
});
