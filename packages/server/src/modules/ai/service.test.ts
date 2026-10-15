import { AppError, deferred } from "@talos/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Jobs } from "../../kernel/jobs/jobs.ts";
import { windows } from "./billing/service.ts";
import { AiService } from "./service.ts";
import { FakeProvider } from "./testing/provider.ts";
import { setupAi } from "./testing/setup.ts";
let s: ReturnType<typeof setupAi>;
beforeEach(() => {
  vi.useFakeTimers();
  s = setupAi();
});
afterEach(() => {
  s.close();
  vi.useRealTimers();
});
async function drain() {
  await vi.advanceTimersByTimeAsync(1);
}
describe("durable AI runs and accounting", () => {
  it("streams windowed rows, completes a durable job, settles exactly once and forks ancestry", async () => {
    const user = s.users[0]!,
      c = s.service.create(user, "测试");
    s.fund();
    const changes: unknown[] = [];
    s.hub.pull(
      user,
      { cursors: {} },
      { id: "connection", emit: (_t, d) => changes.push(d) },
    );
    const run = s.service.start(user, { conversation: c.id, text: "你好" });
    s.jobs.start();
    await drain();
    const record = s.service.repo.run(run.id)!;
    expect(record.state).toBe("done");
    expect(s.jobs.get(record.job)?.state).toBe("done");
    expect(
      s.service.page(user, { conversation: c.id }).messages[1]?.text,
    ).toContain("const answer");
    expect(changes.length).toBeGreaterThan(2);
    expect(s.service.billing.account(user).reserved).toBe(0);
    expect(s.service.billing.account(user).topup).toBe(
      100000000 - record.charged,
    );
    s.service.stop(user, run.id);
    expect(s.service.billing.account(user).topup).toBe(
      100000000 - record.charged,
    );
    const message = s.service.repo.messages(c.id)[0]!;
    const fork = s.service.fork(user, message.id);
    expect(s.service.repo.messages(fork.id)).toHaveLength(1);
    expect(s.service.repo.messages(c.id)).toHaveLength(2);
  });
  it("rejects insufficient credit and concurrent conversation starts without inserting messages", () => {
    const u = s.users[0]!,
      c = s.service.create(u, "问题");
    expect(() =>
      s.service.start(u, { conversation: c.id, text: "问题" }),
    ).toThrow("额度不足");
    expect(s.service.repo.messages(c.id)).toEqual([]);
    s.fund();
    s.service.start(u, { conversation: c.id, text: "问题" });
    expect(() =>
      s.service.start(u, { conversation: c.id, text: "问题" }),
    ).toThrow("正在生成");
    expect(s.service.repo.messages(c.id)).toHaveLength(2);
  });
  it("durably cancels queued jobs and releases reservations", async () => {
    const u = s.users[0]!,
      c = s.service.create(u, "取消");
    s.fund();
    const run = s.service.start(u, { conversation: c.id, text: "问题" });
    s.service.stop(u, run.id);
    s.jobs.start();
    await drain();
    expect(s.service.repo.run(run.id)?.state).toBe("cancelled");
    expect(s.service.billing.account(u).available).toBe(100000000);
    expect(s.service.repo.messages(c.id)[1]?.status).toBe("cancelled");
  });
  it("aborts live provider and retains already checkpointed text", async () => {
    s.close();
    const wait = deferred<void>();
    let signal: AbortSignal | undefined;
    const provider = new FakeProvider(async (sig) => {
      signal = sig;
      await wait.promise;
    });
    s = setupAi(provider);
    const u = s.users[0]!,
      c = s.service.create(u, "取消");
    s.fund();
    const run = s.service.start(u, { conversation: c.id, text: "问题" });
    s.jobs.start();
    await drain();
    s.service.stop(u, run.id);
    expect(signal?.aborted).toBe(true);
    wait.resolve();
    await drain();
    expect(s.service.repo.run(run.id)?.state).toBe("cancelled");
    expect(s.service.billing.account(u).reserved).toBe(0);
  });
  it("journals tool calls and makes the resulting file readable", async () => {
    const u = s.users[0]!,
      c = s.service.create(u, "写作");
    s.fund();
    s.service.start(u, { conversation: c.id, text: "创建文件" });
    s.jobs.start();
    await drain();
    expect(s.service.workspace.read(u, "笔记/学习.md").content).toContain(
      "学习笔记",
    );
    expect(s.service.repo.files(u)).toHaveLength(1);
  });
  it("retains partial answer and reconciles reservation on process restart without replaying tools", async () => {
    const u = s.users[0]!,
      c = s.service.create(u, "重启");
    s.fund();
    const run = s.service.start(u, { conversation: c.id, text: "问题" });
    s.service.repo.finishRun(run.id, "running", 123);
    s.service.close();
    s.jobs.close();
    const jobs = new Jobs({ db: s.db, uow: s.uow, clock: s.now, id: s.id });
    const service = new AiService({ ...s.service.options, jobs });
    expect(service.repo.run(run.id)?.state).toBe("failed");
    expect(service.billing.account(u).topup).toBe(100000000 - 123);
    service.close();
    jobs.close();
    await drain();
  });
  it("settles errors without exposing upstream credentials", async () => {
    s.close();
    s = setupAi({
      models: new FakeProvider().models,
      async *stream() {
        yield { type: "text", text: "部分内容" };
        throw new Error("secret-token");
      },
    });
    const u = s.users[0]!,
      c = s.service.create(u, "失败");
    s.fund();
    s.service.start(u, { conversation: c.id, text: "问题" });
    s.jobs.start();
    await drain();
    const m = s.service.repo.messages(c.id)[1]!;
    expect(m.text).toBe("部分内容");
    expect(m.error).not.toContain("secret");
    expect(m.status).toBe("failed");
    expect(s.service.billing.account(u).reserved).toBe(0);
  });
  it("keeps drafts LWW with staging provenance and supports 100k CJK text without oversize sync", () => {
    const u = s.users[0]!,
      id = s.id(),
      text = "中".repeat(100000);
    for (let offset = 0; offset < text.length; offset += 16000)
      s.service.putText(u, {
        id,
        offset,
        total: text.length,
        text: text.slice(offset, offset + 16000),
      });
    const newer = {
      id: "new",
      textId: id,
      value: { v: text.slice(0, 16000), t: { ms: 2, counter: 0 }, op: s.id() },
    };
    s.service.draft(u, newer);
    s.service.draft(u, {
      id: "new",
      value: { v: "old", t: { ms: 1, counter: 0 }, op: s.id() },
    });
    expect(s.service.repo.get(u, "aiDraft", "new")).toEqual(newer);
    expect(s.service.content(u, "draft", id, 0).body.length).toBe(65536);
    expect(() => s.hub.pull(u, { cursors: {} })).not.toThrow();
    s.fund();
    const conversation = s.service.create(u, "长文");
    s.service.start(u, {
      conversation: conversation.id,
      text: text.slice(0, 16000),
      textId: id,
    });
    const messages = s.service.page(u, {
      conversation: conversation.id,
    }).messages;
    expect(messages[0]?.textLength).toBe(100000);
    expect(messages[0]?.text.length).toBe(16000);
    expect(() => s.hub.pull(u, { cursors: {} })).not.toThrow();
  });
  it("prevents cross-user reads, forks, stop and staged text access", () => {
    const [u, v] = s.users as [string, string],
      c = s.service.create(u, "私密");
    s.fund();
    const run = s.service.start(u, { conversation: c.id, text: "secret" });
    expect(() => s.service.page(v, { conversation: c.id })).toThrow("不存在");
    expect(() => s.service.stop(v, run.id)).toThrow("不存在");
    expect(() =>
      s.service.fork(v, s.service.repo.messages(c.id)[0]!.id),
    ).toThrow("不存在");
    expect(s.hub.pull(v, { cursors: { [`ai:${c.id}`]: 0 } }).gone).toContain(
      `ai:${c.id}`,
    );
  });
});
describe("AI credit windows and assignment", () => {
  it("deduplicates assignment keys permanently and rejects changed arguments", () => {
    const args = {
      user: s.users[0]!,
      key: s.id(),
      amount: 500,
      days: 30,
      note: "赠送",
    };
    const first = s.service.billing.assign(args);
    expect(s.service.billing.assign(args)).toEqual(first);
    expect(() => s.service.billing.assign({ ...args, amount: 501 })).toThrow(
      "标识",
    );
    expect(first.planEnds).toBe(s.now() + 30 * 86400000);
  });
  it("uses UTC Monday weeks at Sunday/Monday and month boundaries", () => {
    expect(windows(Date.UTC(2026, 9, 11, 23, 59))).toEqual({
      day: "2026-10-11",
      week: "2026-10-05",
    });
    expect(windows(Date.UTC(2026, 9, 12))).toEqual({
      day: "2026-10-12",
      week: "2026-10-12",
    });
  });
  it("consumes plan first with independent daily and weekly limits and expires plans", async () => {
    const u = s.users[0]!;
    s.service.billing.policy({ daily: 10000000, weekly: 12000000, days: 1 }, [
      u,
    ]);
    s.service.billing.assign({
      user: u,
      key: s.id(),
      amount: 100000000,
      days: 1,
      note: "",
    });
    const c = s.service.create(u, "套餐");
    const run = s.service.start(u, { conversation: c.id, text: "问题" });
    expect(s.service.repo.run(run.id)?.plan).toBeGreaterThan(0);
    s.jobs.start();
    await drain();
    const charged = s.service.repo.run(run.id)!.charged;
    expect(s.service.billing.account(u).dayUsed).toBe(charged);
    expect(s.service.billing.account(u).topup).toBe(100000000);
    s.setTime(s.now() + 86400000);
    expect(s.service.billing.account(u).dayUsed).toBe(0);
    expect(s.service.billing.account(u).available).toBe(100000000);
  });
  it("keeps arithmetic conserved across randomized reservations and cancellation", () => {
    const u = s.users[0]!;
    s.fund();
    for (let i = 0; i < 60; i++) {
      const c = s.service.create(u, `对话 ${i}`),
        run = s.service.start(u, {
          conversation: c.id,
          text: "中".repeat(i + 1),
        });
      const account = s.service.billing.account(u);
      expect(account.available + account.reserved).toBe(100000000);
      s.service.stop(u, run.id);
      expect(s.service.billing.account(u).available).toBe(100000000);
    }
  });
  it("handles unavailable provider as a business denial", () => {
    s.service.options.provider = undefined;
    const c = s.service.create(s.users[0]!, "缺少配置");
    expect(() =>
      s.service.start(s.users[0]!, { conversation: c.id, text: "test" }),
    ).toThrow(AppError);
  });
});
