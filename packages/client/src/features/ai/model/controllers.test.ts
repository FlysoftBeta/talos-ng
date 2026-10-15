import { describe, expect, it, vi } from "vitest";
import { ai, contract } from "@talos/contract";
import type { Method } from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
import type { Nav } from "../../../core/navigation/index.ts";
import { BillingController, chartModel } from "./billing.ts";
import type { AiBillingPort } from "./billing.ts";
import { AiListController } from "./conversation-list.ts";
import type { AiListPort } from "./conversation-list.ts";
import {
  ConversationController,
  MessageTextController,
  composerReason,
  parseTags,
} from "./conversation.ts";
import type { AiConversationPort } from "./conversation.ts";
import type { AiImageFiles, AiPickedFile } from "./commands.ts";
import { WorkspaceController, base64 } from "./workspace.ts";
import type { AiWorkspacePort } from "./workspace.ts";

const id = "01ARZ3NDEKTSV4RRFFQ69G5FA0",
  other = "01ARZ3NDEKTSV4RRFFQ69G5FA1",
  op = "01ARZ3NDEKTSV4RRFFQ69G5FA9";
const conversation = (patch: Record<string, unknown> = {}): StoredRow => ({
  scope: "me:u",
  type: "aiConversation",
  id,
  rev: 1,
  deleted: false,
  data: {
    id,
    title: "标题",
    tags: [],
    lastSeq: 0,
    readSeq: 0,
    running: null,
    updated: 1,
    ...patch,
  },
});
const credit = (patch: Record<string, unknown> = {}): StoredRow => ({
  scope: "me:u",
  type: "aiCredit",
  id: "account",
  rev: 1,
  deleted: false,
  data: {
    id: "account",
    configured: true,
    topup: 0,
    reserved: 0,
    daily: 100,
    weekly: 100,
    dayUsed: 0,
    weekUsed: 0,
    available: 10,
    planEnds: 0,
    required: 1,
    ...patch,
  },
});
const message = (patch: Record<string, unknown> = {}): StoredRow => {
  const data = {
    id: other,
    conversation: id,
    seq: 1,
    rev: 1,
    role: "assistant",
    text: "短",
    images: [],
    status: "done",
    created: 1,
    error: null,
    ...patch,
  };
  return {
    scope: `ai:${id}`,
    type: "aiMessage",
    id: String(data.id),
    rev: 1,
    deleted: false,
    data,
  };
};
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Scriptable runtime double: records commands in order, replies from `handlers`. */
function fakePort(initial: StoredRow[] = [], online = true) {
  let rows: readonly StoredRow[] = initial;
  const repoListeners = new Set<() => void>(),
    runtimeListeners = new Set<() => void>(),
    calls: Array<{ method: string; args: unknown }> = [],
    handlers = new Map<string, (args: unknown) => unknown>(),
    local = new Map<string, unknown>(),
    timers = new Map<number, () => void>();
  let counter = 0,
    timer = 0;
  const nav: Nav = {
    area: "ai",
    areas: { ai: { stack: [{ kind: "page", id }] } },
    overlays: [],
  } as unknown as Nav;
  const port = {
    calls,
    handlers,
    local,
    dispatched: [] as unknown[],
    setRows(next: StoredRow[]) {
      rows = next;
      repoListeners.forEach((l) => l());
    },
    setOnline(next: boolean) {
      online = next;
      runtimeListeners.forEach((l) => l());
    },
    runTimers() {
      const due = [...timers.values()];
      timers.clear();
      due.forEach((fn) => fn());
    },
    repositories: new Map([
      [
        "ai.rows",
        {
          getSnapshot: () => rows,
          subscribe: (l: () => void) => {
            repoListeners.add(l);
            return () => repoListeners.delete(l);
          },
        },
      ],
    ]) as AiConversationPort["repositories"],
    subscribe: (l: () => void) => {
      runtimeListeners.add(l);
      return () => runtimeListeners.delete(l);
    },
    getSnapshot: () => ({ nav }) as never,
    can: () =>
      online ? { ok: true as const } : { ok: false as const, reason: "离线" },
    operation: () => ({
      op: `${op}${++counter}`.slice(-26),
      t: { ms: counter, counter: 0 },
    }),
    command: vi.fn(async (m: Method, args: unknown) => {
      calls.push({ method: m.name, args });
      return handlers.get(m.name)?.(args) ?? {};
    }),
    fetchBody: vi.fn(async (m: Method, args: unknown) => {
      calls.push({ method: m.name, args });
      return handlers.get(m.name)?.(args) as never;
    }),
    flush: vi.fn(async () => {
      calls.push({ method: "flush", args: undefined });
    }),
    sync: vi.fn(async () => {
      calls.push({ method: "sync", args: undefined });
    }),
    loadRows: vi.fn(async () => undefined),
    getLocal: async <T>(key: string) => local.get(key) as T | undefined,
    setLocal: async (key: string, value: unknown) => {
      local.set(key, value);
    },
    dispatch(intent: unknown) {
      port.dispatched.push(intent);
    },
    delay: (fn: () => void) => {
      timers.set(++timer, fn);
      return timer;
    },
    clearDelay: (t: unknown) => {
      timers.delete(t as number);
    },
  };
  return port;
}

interface PickedImage extends AiPickedFile {
  name: string;
}
function fakeFiles() {
  const revoked: string[] = [];
  const files: AiImageFiles<PickedImage> & { revoked: string[] } = {
    revoked,
    read: async () => new Uint8Array(3),
    preview: (f) => `blob:${f.name}`,
    revoke: (u) => {
      revoked.push(u);
    },
  };
  return files;
}
const png = (name = "a"): PickedImage => ({ name, type: "image/png", size: 3 });

describe("composerReason", () => {
  const base = {
    send: { ok: true as const },
    busy: false,
    running: false,
    credit: undefined,
    text: "hi",
  };
  it("orders capability, busy, running, configuration, credit and empty text", () => {
    expect(
      composerReason({ ...base, send: { ok: false, reason: "离线" } }),
    ).toBe("离线");
    expect(composerReason({ ...base, busy: true })).toBe("正在提交，请稍候");
    expect(composerReason({ ...base, running: true })).toBe("当前对话正在生成");
    expect(composerReason(base)).toBe("AI 尚未配置");
    const c = (patch: object) =>
      ({ configured: true, available: 5, required: 1, ...patch }) as never;
    expect(composerReason({ ...base, credit: c({ available: 0 }) })).toBe(
      "额度不足，请联系功能管理员充值",
    );
    expect(composerReason({ ...base, credit: c({}), text: "  " })).toBe(
      "请输入文字，图片不能单独发送",
    );
    expect(composerReason({ ...base, credit: c({}) })).toBe("");
  });
  it("parses tags with both comma forms", () => {
    expect(parseTags(" a，b, ,c ")).toEqual(["a", "b", "c"]);
  });
});

describe("ConversationController", () => {
  const setup = (rows = [conversation(), credit()], online = true) => {
    const port = fakePort(rows, online),
      files = fakeFiles(),
      controller = new ConversationController<PickedImage>(
        port as unknown as AiConversationPort,
        id,
        files,
      );
    return { port, files, controller };
  };

  it("loads the first page and the account on attach and again only when sending becomes possible", async () => {
    const { port, controller } = setup(undefined, false);
    port.handlers.set("ai.message.page", () => ({ messages: [], more: true }));
    controller.attach();
    await flush();
    expect(port.calls.map((c) => c.method)).toEqual([]);
    port.setOnline(true);
    await flush();
    expect(port.calls.map((c) => c.method)).toEqual([
      "ai.message.page",
      "ai.account.get",
    ]);
    expect(controller.getState().more).toBe(true);
    port.setRows([conversation(), credit(), credit()]);
    await flush();
    expect(port.calls).toHaveLength(2);
    controller.detach();
  });

  it("advances the read cursor once per change and not while a run is active", async () => {
    const { port, controller } = setup([
      conversation({ lastSeq: 4, readSeq: 1 }),
      credit(),
    ]);
    controller.attach();
    await flush();
    const reads = () =>
      port.calls.filter((c) => c.method === "ai.conversation.read");
    expect(reads()).toEqual([
      { method: "ai.conversation.read", args: { id, seq: 4 } },
    ]);
    port.setRows([conversation({ lastSeq: 4, readSeq: 1 }), credit()]);
    expect(reads()).toHaveLength(1);
    port.setRows([
      conversation({ lastSeq: 6, readSeq: 1, running: other }),
      credit(),
    ]);
    expect(reads()).toHaveLength(1);
    controller.detach();
  });

  it("restores the stored draft, follows remote draft changes until the user types", async () => {
    const draft = (v: string): StoredRow => ({
      scope: "me:u",
      type: "aiDraft",
      id,
      rev: 1,
      deleted: false,
      data: { id, value: { v, t: { ms: 1, counter: 0 }, op } },
    });
    const { port, controller } = setup([conversation(), credit(), draft("甲")]);
    controller.attach();
    expect(controller.getState().text).toBe("甲");
    port.setRows([conversation(), credit(), draft("乙")]);
    expect(controller.getState().text).toBe("乙");
    controller.setText("本地");
    port.setRows([conversation(), credit(), draft("丙")]);
    expect(controller.getState().text).toBe("本地");
    await flush();
    controller.detach();
  });

  it("sends after the draft write, flushes, starts the run, clears the composer and refreshes", async () => {
    const { port, controller } = setup();
    port.handlers.set("ai.message.page", () => ({ messages: [], more: false }));
    controller.attach();
    await flush();
    port.calls.length = 0;
    controller.setText("你好");
    await controller.send();
    await flush();
    const methods = port.calls.map((c) => c.method);
    expect(methods.slice(0, 3)).toEqual([
      "ai.draft.set",
      "flush",
      "ai.run.start",
    ]);
    expect(methods.slice(3)).toEqual(
      expect.arrayContaining(["sync", "ai.message.page", "ai.draft.set"]),
    );
    const drafts = port.calls.filter((c) => c.method === "ai.draft.set");
    expect(drafts.at(-1)!.args).toMatchObject({ value: { v: "" } });
    const start = port.calls.find((c) => c.method === "ai.run.start")!;
    expect(start.args).toMatchObject({
      conversation: id,
      text: "你好",
      images: [],
    });
    expect(controller.getState()).toMatchObject({
      text: "",
      busy: false,
      error: "",
    });
    controller.detach();
  });

  it("does not send while the composer has a reason and reports a failed start", async () => {
    const { port, controller } = setup([
      conversation({ running: other }),
      credit(),
    ]);
    controller.attach();
    await flush();
    port.calls.length = 0;
    await controller.send();
    expect(port.calls).toEqual([]);
    port.setRows([conversation(), credit()]);
    port.handlers.set("ai.run.start", () => {
      throw new Error("额度用尽");
    });
    controller.setText("x");
    await controller.send();
    expect(controller.getState()).toMatchObject({
      error: "额度用尽",
      busy: false,
      text: "x",
    });
    controller.detach();
  });

  it("stages text above the chunk limit through durable chunks", async () => {
    const { port, controller } = setup();
    controller.attach();
    await flush();
    port.calls.length = 0;
    controller.setText("字".repeat(16001));
    await flush();
    await flush();
    const puts = port.calls.filter((c) => c.method === "ai.text.put");
    expect(puts).toHaveLength(2);
    expect(puts[1]!.args).toMatchObject({ offset: 16000, total: 16001 });
    controller.detach();
  });

  it("uploads picked images, keeps previews for chips and revokes them on removal and detach", async () => {
    const { port, files, controller } = setup();
    port.handlers.set("ai.workspace.image", () => ({
      path: "attachments/a.png",
    }));
    port.handlers.set("upload.begin", () => ({}));
    controller.attach();
    await flush();
    controller.addImage(png("a"));
    expect(controller.getState().busy).toBe(true);
    await flush();
    await flush();
    expect(controller.getState()).toMatchObject({
      images: ["attachments/a.png"],
      previews: { "attachments/a.png": "blob:a" },
      busy: false,
    });
    expect(port.local.get(`ai:images:${id}`)).toEqual(["attachments/a.png"]);
    expect(port.calls.map((c) => c.method)).toEqual(
      expect.arrayContaining([
        contract.upload.begin.name,
        contract.upload.commit.name,
      ]),
    );
    controller.removeImage(0);
    expect(files.revoked).toEqual(["blob:a"]);
    controller.addImage(png("b"));
    await flush();
    await flush();
    controller.detach();
    expect(files.revoked).toEqual(["blob:a", "blob:b"]);
  });

  it("rejects unsupported images before any upload and releases their preview", async () => {
    const { port, files, controller } = setup();
    controller.attach();
    await flush();
    port.calls.length = 0;
    controller.addImage({ name: "x", type: "image/bmp", size: 3 });
    await flush();
    expect(port.calls).toEqual([]);
    expect(files.revoked).toEqual(["blob:x"]);
    expect(controller.getState().error).toContain("仅支持");
    expect(controller.getState().busy).toBe(false);
    controller.detach();
  });

  it("restores picked images from the local cache and caps the list at four", async () => {
    const { port, controller } = setup();
    port.local.set(`ai:images:${id}`, ["1", "2", "3", "4"]);
    controller.attach();
    await flush();
    expect(controller.getState().images).toHaveLength(4);
    expect(controller.getState().canAddImage).toBe(false);
    controller.detach();
  });

  it("forks into the new conversation after syncing, and saves parsed tags", async () => {
    const { port, controller } = setup();
    port.handlers.set("ai.conversation.fork", () => ({ id: other }));
    controller.attach();
    await flush();
    controller.fork(other);
    await flush();
    await flush();
    expect(port.dispatched).toEqual([
      { type: "pushPage", area: "ai", page: { kind: "page", id: other } },
    ]);
    expect(await controller.saveDetails("新", "甲，乙")).toBe(true);
    expect(port.calls.at(-1)).toEqual({
      method: "ai.conversation.update",
      args: { id, title: "新", tags: ["甲", "乙"] },
    });
    controller.detach();
  });

  it("ignores results after detach", async () => {
    const { port, controller } = setup();
    let release!: () => void;
    port.handlers.set(
      "ai.message.page",
      () => new Promise<void>((r) => (release = r)),
    );
    controller.attach();
    await flush();
    controller.detach();
    release();
    await flush();
    expect(controller.getState().more).toBe(false);
  });
});

describe("MessageTextController", () => {
  const long = (rev: number) =>
    ({
      ...(message({ text: "前缀", textLength: 5, rev }).data as object),
    }) as never;
  it("replaces a truncated body with the fetched text and drops stale responses", async () => {
    const port = fakePort(),
      gate: Array<(v: unknown) => void> = [];
    port.handlers.set(
      ai.content.fetch.name,
      () => new Promise((r) => gate.push(r)),
    );
    const c = new MessageTextController(port as never, long(1));
    c.update(long(1));
    await flush();
    const first = gate.shift()!;
    c.update(long(2));
    await flush();
    first({ data: { eof: true }, body: new TextEncoder().encode("旧完整") });
    await flush();
    expect(c.getState().text).toBe("前缀");
    gate.shift()!({
      data: { eof: true },
      body: new TextEncoder().encode("新完整"),
    });
    await flush();
    await flush();
    expect(c.getState().text).toBe("新完整");
    expect(port.local.get(`ai:full:${other}:2`)).toBe("新完整");
  });
  it("keeps already streamed text that extends the synchronized prefix", () => {
    const port = fakePort(),
      c = new MessageTextController(port as never, long(1));
    c.update(long(1));
    port.setOnline(false);
    expect(c.getState().text).toBe("前缀");
  });
});

describe("AiListController", () => {
  it("filters by title and tags after the debounce and builds row hints", () => {
    const port = fakePort([
      conversation({ title: "数学", tags: ["作业"], lastSeq: 2, readSeq: 1 }),
      credit({
        daily: 200,
        dayUsed: 50,
        weekly: 100,
        weekUsed: 100,
        available: 1500000,
      }),
    ]);
    const c = new AiListController(port as unknown as AiListPort);
    c.attach();
    expect(c.getState().items).toEqual([
      { id, title: "数学", hint: "作业", selected: true, trailing: "未读" },
    ]);
    expect(c.getState().creditLine).toBe(
      "每日剩余 75% · 每周剩余 0% · 可用 1.50 额度",
    );
    c.setQuery(" 作 ");
    expect(c.getState().items).toHaveLength(1);
    port.setRows([conversation({ title: "数学", tags: ["作业"] })]);
    c.setQuery("英语");
    c.setQuery("英语 ");
    port.runTimers();
    expect(c.getState()).toMatchObject({
      items: [],
      emptyTitle: "没有匹配的对话",
    });
    c.detach();
  });
  it("creates a conversation, opens it and syncs", async () => {
    const port = fakePort([conversation()]);
    port.handlers.set("ai.conversation.create", () => ({ id: other }));
    const c = new AiListController(port as unknown as AiListPort);
    c.create();
    await flush();
    await flush();
    expect(port.dispatched).toEqual([
      { type: "pushPage", area: "ai", page: { kind: "page", id: other } },
    ]);
    expect(port.sync).toHaveBeenCalled();
  });
});

describe("WorkspaceController", () => {
  const file = { path: "a.md", mime: "text/markdown", size: 2048, rev: 3 };
  const setup = (online = true) => {
    const port = fakePort([], online);
    port.handlers.set("ai.workspace.list", () => [file]);
    port.handlers.set("ai.content.fetch", () => ({
      data: { eof: true },
      body: new TextEncoder().encode("正文"),
    }));
    const c = new WorkspaceController(port as unknown as AiWorkspacePort);
    c.attach();
    return { port, c };
  };
  it("lists on open, keeps an offline copy, and reads the copy while offline", async () => {
    const { port, c } = setup();
    c.setOpen(true);
    await flush();
    expect(c.getState().files).toEqual([file]);
    expect(port.local.get("ai:workspace-list")).toEqual([file]);
    port.setOnline(false);
    c.setOpen(false);
    c.setOpen(true);
    await flush();
    expect(c.getState().files).toEqual([file]);
  });
  it("caches opened files per revision and reports uncached files offline", async () => {
    const { port, c } = setup();
    c.setOpen(true);
    await flush();
    await c.select(file);
    expect(c.getState()).toMatchObject({
      text: "正文",
      path: "a.md",
      preview: true,
    });
    expect(port.local.get("ai:file:a.md:3")).toBe("正文");
    port.setOnline(false);
    await c.select({ ...file, rev: 4 });
    expect(c.getState().error).toBe("离线未缓存");
    await c.select(file);
    expect(c.getState().error).toBe("");
  });
  it("saves with the loaded revision as precondition and deletes after confirmation", async () => {
    const { port, c } = setup();
    c.setOpen(true);
    await flush();
    await c.select(file);
    c.setText("改");
    port.handlers.set("ai.workspace.write", () => ({ ...file, rev: 4 }));
    await c.save();
    expect(
      port.calls.find((x) => x.method === "ai.workspace.write")!.args,
    ).toMatchObject({
      path: "a.md",
      content: "改",
      expected: 3,
    });
    expect(c.getState().selected?.rev).toBe(4);
    c.askDelete();
    await c.remove();
    expect(
      port.calls.find((x) => x.method === "ai.workspace.delete")!.args,
    ).toEqual({
      path: "a.md",
      expected: 4,
    });
    expect(c.getState()).toMatchObject({ confirm: false, path: "" });
  });
  it("encodes bytes as standard padded base64", () => {
    for (const n of [0, 1, 2, 3, 4, 5])
      expect(base64(new Uint8Array(n).fill(255))).toBe(
        Buffer.from(new Uint8Array(n).fill(255)).toString("base64"),
      );
  });
});

describe("BillingController", () => {
  const stats = {
    policy: { daily: 2e6, weekly: 5e6, days: 30 },
    topup: 0,
    planStock: 0,
    consumed: 0,
    days: [{ day: "2026-05-30", amount: 4e6 }],
    ledger: [],
  };
  const setup = () => {
    const port = fakePort();
    port.handlers.set("ai.admin.stats", () => stats);
    port.handlers.set("ai.admin.users", () => [
      { id: other, name: "甲", handle: "a" },
    ]);
    const c = new BillingController(port as unknown as AiBillingPort);
    c.attach();
    return { port, c };
  };
  it("loads stats and users once capability allows and adopts the policy values", async () => {
    const { c } = setup();
    await flush();
    await flush();
    expect(c.getState()).toMatchObject({ daily: "2", weekly: "5", days: "30" });
    expect(c.getState().users).toHaveLength(1);
  });
  it("renews the assignment key only when its inputs change and after success", async () => {
    const { port, c } = setup();
    await flush();
    const key0 = c.getState().key;
    c.setField("query", "x");
    c.setField("daily", "9");
    expect(c.getState().key).toBe(key0);
    c.setField("user", other);
    const key1 = c.getState().key;
    expect(key1).not.toBe(key0);
    port.handlers.set("ai.admin.assign", () => ({ available: 1, topup: 2 }));
    c.assign();
    await flush();
    await flush();
    expect(
      port.calls.find((x) => x.method === "ai.admin.assign")!.args,
    ).toMatchObject({
      user: other,
      key: key1,
      amount: 100e6,
      days: 0,
    });
    expect(c.getState().key).not.toBe(key1);
    expect(c.getState().busy).toBe(false);
  });
  it("scales the chart to the thirty days ending at the latest recorded day", () => {
    const m = chartModel(stats.days as never, 0);
    expect(m.bars).toHaveLength(30);
    expect(m.bars[29]).toMatchObject({
      day: "2026-05-30",
      height: 110,
      label: "05-30",
    });
    expect(m.bars[0]).toMatchObject({
      day: "2026-05-01",
      height: 1,
      label: "05-01",
    });
    expect(m.ticks.map((t) => t.label)).toEqual(["0.0", "2.0", "4.0"]);
  });
});
