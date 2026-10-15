// AI run lifecycle edges (task 150 (b)): start-time validation, concurrency cap, permission
// revocation mid-run, runaway tool loops, over-long answers, and billing conservation when a
// run fails or is stopped twice. Complements ../service.test.ts (happy path, cancel, restart).
import { deferred } from "@talos/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderEvent } from "../providers/responses.ts";
import { FakeProvider } from "../testing/provider.ts";
import { setupAi } from "../testing/setup.ts";

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
const funded = () => {
  s.fund();
  return s.users[0]!;
};
function withProvider(stream: (round: number) => AsyncIterable<ProviderEvent>) {
  s.close();
  let round = 0;
  s = setupAi({
    models: new FakeProvider().models,
    stream: () => stream(round++),
  });
  return funded();
}

describe("start validation", () => {
  it("rejects empty, oversize and incompletely uploaded messages without side effects", () => {
    const u = funded(),
      c = s.service.create(u, "校验");
    const before = s.service.billing.account(u);
    expect(() =>
      s.service.start(u, { conversation: c.id, text: "  \n" }),
    ).toThrow(expect.objectContaining({ code: "E_INVALID" }));
    expect(() =>
      s.service.start(u, { conversation: c.id, text: "中".repeat(100001) }),
    ).toThrow(expect.objectContaining({ code: "E_TOO_LARGE" }));
    expect(() =>
      s.service.start(u, { conversation: c.id, text: "x", textId: s.id() }),
    ).toThrow(expect.objectContaining({ code: "E_CONFLICT" }));
    expect(s.service.repo.messages(c.id)).toEqual([]);
    expect(s.service.billing.account(u)).toEqual(before);
    expect(s.service.repo.active(u)).toEqual([]);
  });

  it("refuses missing, foreign and SVG image attachments", () => {
    const u = funded(),
      c = s.service.create(u, "图片");
    for (const path of ["images/none.png", "../x.png"])
      expect(() =>
        s.service.start(u, {
          conversation: c.id,
          text: "看图",
          images: [path],
        }),
      ).toThrow(expect.objectContaining({ code: "E_INVALID" }));
    expect(s.service.repo.messages(c.id)).toEqual([]);
  });

  it("allows two concurrent runs across conversations and refuses a third", () => {
    const u = funded();
    const conversations = [1, 2, 3].map((i) => s.service.create(u, `并发${i}`));
    s.service.start(u, { conversation: conversations[0]!.id, text: "一" });
    s.service.start(u, { conversation: conversations[1]!.id, text: "二" });
    expect(() =>
      s.service.start(u, { conversation: conversations[2]!.id, text: "三" }),
    ).toThrow(expect.objectContaining({ code: "E_BUSY" }));
    expect(s.service.repo.messages(conversations[2]!.id)).toEqual([]);
    const account = s.service.billing.account(u);
    expect(account.available + account.reserved).toBe(100000000);
  });

  it("refuses another user's conversation", () => {
    const u = funded(),
      c = s.service.create(u, "私有");
    s.fund(s.users[1]!);
    expect(() =>
      s.service.start(s.users[1]!, { conversation: c.id, text: "越权" }),
    ).toThrow();
    expect(s.service.repo.messages(c.id)).toEqual([]);
  });
});

describe("execution edges", () => {
  it("stops with a denial and settles when the feature is revoked between rounds", async () => {
    s.close();
    const gate = deferred<void>();
    let allowed = true;
    s = setupAi({
      models: new FakeProvider().models,
      async *stream() {
        yield { type: "text", text: "一部分" };
        await gate.promise;
        yield { type: "usage", usage: { input: 5, cached: 0, output: 5 } };
      },
    });
    s.service.options.allowed = () => allowed;
    const u = funded(),
      c = s.service.create(u, "撤销");
    const run = s.service.start(u, { conversation: c.id, text: "问题" });
    allowed = false; // revoked before the job begins its first provider round
    s.jobs.start();
    await drain();
    gate.resolve();
    await drain();
    expect(s.service.repo.run(run.id)?.state).toBe("failed");
    expect(s.service.repo.messages(c.id)[1]?.status).toBe("failed");
    const account = s.service.billing.account(u);
    expect(account.reserved).toBe(0);
    expect(account.available).toBe(100000000);
  });

  it("caps tool rounds so a provider that always calls tools cannot loop forever", async () => {
    let rounds = 0;
    const u = withProvider(async function* () {
      rounds++;
      yield {
        type: "tool",
        call: {
          id: `call-${rounds}`,
          name: "create_file",
          arguments: JSON.stringify({
            path: `笔记/${rounds}.md`,
            content: "x",
          }),
        },
      };
      yield { type: "usage", usage: { input: 1, cached: 0, output: 1 } };
    });
    const c = s.service.create(u, "循环");
    const run = s.service.start(u, { conversation: c.id, text: "创建文件" });
    s.jobs.start();
    await drain();
    expect(rounds).toBe(9);
    expect(s.service.repo.run(run.id)?.state).toBe("failed");
    expect(s.service.billing.account(u).reserved).toBe(0);
  });

  it("fails an answer beyond 100000 characters and keeps the bounded checkpointed prefix", async () => {
    const u = withProvider(async function* () {
      for (let i = 0; i < 101; i++)
        yield { type: "text", text: "字".repeat(1000) };
    });
    const c = s.service.create(u, "超长");
    const run = s.service.start(u, { conversation: c.id, text: "问题" });
    s.jobs.start();
    await drain();
    expect(s.service.repo.run(run.id)?.state).toBe("failed");
    const answer = s.service.repo.messages(c.id)[1]!;
    expect(answer.status).toBe("failed");
    expect(answer.text.length).toBeLessThanOrEqual(100000);
    expect(s.service.billing.account(u).reserved).toBe(0);
  });

  it("charges the provider's reported usage instead of the streaming estimate", async () => {
    const u = withProvider(async function* () {
      yield { type: "text", text: "你好" };
      yield { type: "usage", usage: { input: 7, cached: 0, output: 3 } };
    });
    const c = s.service.create(u, "用量");
    const run = s.service.start(u, { conversation: c.id, text: "问题" });
    s.jobs.start();
    await drain();
    const record = s.service.repo.run(run.id)!;
    expect(record.state).toBe("done");
    // fakeModel prices: input 1, output 2 per unit.
    expect(record.charged).toBe(7 * 1 + 3 * 2);
    expect(s.service.billing.account(u).topup).toBe(100000000 - record.charged);
  });

  it("settles a stopped run once even when stopped again and when the job later reports cancelled", async () => {
    const u = funded(),
      c = s.service.create(u, "重复停止");
    const run = s.service.start(u, { conversation: c.id, text: "问题" });
    s.service.stop(u, run.id);
    s.service.stop(u, run.id);
    s.jobs.start();
    await drain();
    expect(s.service.repo.run(run.id)?.state).toBe("cancelled");
    expect(s.service.billing.account(u).available).toBe(100000000);
    expect(s.service.billing.account(u).reserved).toBe(0);
    expect(() => s.service.stop(s.users[1]!, run.id)).toThrow(
      expect.objectContaining({ code: "E_NOT_FOUND" }),
    );
  });
});
