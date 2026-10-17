import { describe, expect, it, vi } from "vitest";
import { createUlid } from "@talos/base";
import type { StatusViewModel } from "../../core/status/model.ts";
import { ActivityController, buildActivity } from "./model.ts";
import type { JobActions } from "./model.ts";
import type { Task } from "./jobs.ts";

const id = createUlid();
function task(patch: Partial<Task> = {}): Task {
  return {
    id: id(),
    owner: id(),
    kind: "library.convert",
    title: "",
    state: "queued",
    progress: 0,
    message: "",
    result: null,
    error: null,
    attempts: 0,
    created: 1000,
    updated: 1000,
    retryable: true,
    etaMs: null,
    ...patch,
  };
}
const status = (patch: Partial<StatusViewModel> = {}): StatusViewModel => ({
  connection: "connected",
  lastSync: "刚刚",
  pending: 0,
  failed: 0,
  operations: [],
  scopes: [],
  transfers: [],
  storage: "",
  build: "",
  update: { state: "none" },
  ...patch,
});
const actions = (): JobActions => ({
  retry: vi.fn(),
  cancel: vi.fn(),
  blocked: {},
});

describe("activity model", () => {
  it("groups jobs, queued writes and transfers by state with their actions", () => {
    const retry = vi.fn(),
      discard = vi.fn(),
      cancel = vi.fn();
    const model = buildActivity(
      status({
        operations: [
          {
            id: "a",
            title: "保存阅读笔记",
            state: "waiting",
            merged: 3,
            dueAt: 5,
          },
          {
            id: "b",
            title: "发送消息",
            state: "failed",
            merged: 0,
            error: "没有权限",
            retry,
            discard,
          },
        ],
        transfers: [
          { id: "d", title: "红楼梦", direction: "download", progress: 0.4 },
          { id: "e", title: "离线保留", direction: "download", progress: 1 },
          {
            id: "u",
            title: "上传 手册",
            direction: "upload",
            progress: 0,
            error: "网络中断",
            retry,
            cancel,
          },
        ],
      }),
      [
        task({ state: "running", progress: 0.5 }),
        task({ state: "failed", error: { message: "PDF 已加密" } }),
        task({ state: "done" }),
        task({ state: "cancelled" }),
      ],
      actions(),
    );
    expect(model.active.map((item) => item.kind)).toEqual([
      "outbound",
      "download",
      "job",
    ]);
    // Debounced writes say they were merged and are not yet sent.
    expect(model.active[0]!.detail).toBe("已合并 3 次更改，稍后一并发送");
    expect(model.active[1]).toMatchObject({ progress: 0.4 });
    expect(model.attention.map((item) => item.id.split(":")[0])).toEqual([
      "op",
      "xfer",
      "job",
    ]);
    expect(model.attention[0]).toMatchObject({
      error: "没有权限",
      retry: { label: "重试" },
      cancel: { label: "放弃" },
    });
    expect(model.attention[1]).toMatchObject({ error: "网络中断" });
    expect(model.attention[2]).toMatchObject({ error: "PDF 已加密" });
    expect(model.completed).toHaveLength(3);
  });
  it("reports which scopes are already usable while others load", () => {
    const model = buildActivity(
      status({
        scopes: [
          { id: "me:1", title: "个人数据", state: "ready", rows: 4 },
          { id: "conv:1", title: "对话", state: "loading", rows: 20 },
          { id: "coll:1", title: "文档集", state: "waiting", rows: 0 },
        ],
      }),
      [],
      actions(),
    );
    expect(model.scopesReady).toBe(1);
    expect(model.scopes).toHaveLength(3);
  });
  it("blocks job actions offline or without permission but not queued writes", () => {
    const blocked = buildActivity(
      status({
        connection: "offline",
        operations: [
          {
            id: "b",
            title: "发送消息",
            state: "failed",
            merged: 0,
            retry: vi.fn(),
          },
        ],
      }),
      [task({ state: "running" })],
      actions(),
    );
    expect(blocked.active[0]!.blocked).toBe("需要连接服务器");
    expect(blocked.attention[0]!.blocked).toBeUndefined();
    const denied = buildActivity(status(), [task({ state: "running" })], {
      ...actions(),
      blocked: { cancel: "没有权限" },
    });
    expect(denied.active[0]!.blocked).toBe("没有权限");
  });
});

describe("activity controller", () => {
  it("confirms cancellation and cleanup, runs plain actions at once and reports failures", async () => {
    const command = vi.fn<
      (method: unknown, args?: unknown) => Promise<unknown>
    >(async () => ({}));
    const c = new ActivityController({ command } as never);
    const running = task({ state: "running" });
    const model = buildActivity(status(), [running], {
      retry: c.retryJob,
      cancel: c.cancelJob,
      blocked: {},
    });
    c.invoke(model.active[0]!.cancel!);
    expect(command).not.toHaveBeenCalled();
    expect(c.getState().confirmation).toMatchObject({ destructive: false });
    c.dismiss();
    c.confirm();
    expect(command).not.toHaveBeenCalled();
    const discard = vi.fn();
    c.invoke({ label: "放弃", run: discard });
    expect(discard).toHaveBeenCalledOnce();
    c.askClear();
    command.mockRejectedValueOnce(new Error("清理失败"));
    c.confirm();
    await vi.waitFor(() =>
      expect(c.getState()).toMatchObject({ busy: false, error: "清理失败" }),
    );
    expect(command.mock.calls[0]![0]).toMatchObject({ name: "tasks.clear" });
    c.invoke(model.active[0]!.cancel!);
    c.confirm();
    expect(c.getState().error).toBe("");
    expect(command.mock.calls[1]![1]).toEqual({ id: running.id });
  });
});
