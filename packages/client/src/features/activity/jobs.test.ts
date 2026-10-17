import { describe, expect, it } from "vitest";
import { createUlid } from "@talos/base";
import type { StoredRow } from "../../core/data/db.ts";
import {
  canCancelTask,
  canRetryTask,
  selectTasks,
  taskDetail,
  taskTitle,
} from "./jobs.ts";
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
function row(data: Task): StoredRow {
  return {
    scope: `me:${data.owner}`,
    type: "job",
    id: data.id,
    data,
    rev: 1,
    deleted: false,
  };
}
describe("task view model", () => {
  it("filters invalid/deleted rows and orders by creation without progress jumps", () => {
    const old = task({ updated: 9000 }),
      recent = task({ created: 2000 });
    expect(
      selectTasks([
        row(old),
        row(recent),
        { ...row(task()), deleted: true },
        { ...row(task()), data: {} },
      ]).map((t) => t.id),
    ).toEqual([recent.id, old.id]);
  });
  it("shows progress, ETA and safe structured errors", () => {
    expect(
      taskDetail(
        task({
          state: "running",
          progress: 0.5,
          etaMs: 2100,
          message: "第 2 页",
        }),
      ),
    ).toBe("进行中 · 50% · 预计剩余 3 秒 · 第 2 页");
    expect(
      taskDetail(
        task({
          state: "failed",
          error: { code: "E_INVALID", message: "PDF 已加密" },
        }),
      ),
    ).toBe("失败 · PDF 已加密");
    expect(taskDetail(task({ state: "failed", error: ["invalid"] }))).toBe(
      "失败",
    );
  });
  it("omits stale progress messages from terminal states", () => {
    expect(
      taskDetail(
        task({
          state: "done",
          message: "正在转换文档",
          error: { message: "旧错误" },
        }),
      ),
    ).toBe("已完成");
    expect(
      taskDetail(
        task({
          state: "failed",
          message: "正在转换文档",
          error: { message: "转换失败" },
        }),
      ),
    ).toBe("失败 · 转换失败");
    expect(
      taskDetail(task({ state: "cancelled", message: "正在转换文档" })),
    ).toBe("已取消");
    expect(taskDetail(task({ state: "queued", message: "等待转换" }))).toBe(
      "排队中 · 等待转换",
    );
  });
  it("renders zero ETA and unknown jobs without leaking internal kind names", () => {
    expect(taskDetail(task({ state: "running", etaMs: 0 }))).toContain(
      "预计剩余 0 秒",
    );
    expect(taskTitle(task())).toBe("文档转换");
    expect(taskTitle(task({ title: "红楼梦" }))).toBe("红楼梦");
    expect(taskTitle(task({ kind: "internal.future" }))).toBe("后台任务");
  });
});
describe("task actions", () => {
  it("offers only the actions the state allows", () => {
    expect(canRetryTask(task({ state: "failed" }))).toBe(true);
    expect(canRetryTask(task({ state: "failed", retryable: false }))).toBe(
      false,
    );
    expect(canRetryTask(task({ state: "running" }))).toBe(false);
    expect(canCancelTask(task({ state: "queued" }))).toBe(true);
    expect(canCancelTask(task({ state: "done" }))).toBe(false);
  });
});
