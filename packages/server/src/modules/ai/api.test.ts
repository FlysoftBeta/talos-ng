import { sleep } from "@talos/base";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeProvider } from "./testing/provider.ts";
import { setupAi } from "./testing/setup.ts";
let s: ReturnType<typeof setupAi>, clients: LinkClient[];
beforeEach(() => {
  vi.useFakeTimers();
  s = setupAi(new FakeProvider((signal) => sleep(20, signal)));
  clients = [];
  s.jobs.start();
});
afterEach(() => {
  clients.forEach((c) => c.stop());
  s.close();
  vi.useRealTimers();
});
async function connect(user: string) {
  const client = new LinkClient({
    hello: () => ({ v: 1, build: "test", device: "device", lang: "zh-CN" }),
    connect: async () => {
      const pair = createMemoryCarrierPair();
      s.host.link.accept(pair.b, {}).ctx.set("user", user);
      return pair.a;
    },
  });
  clients.push(client);
  client.start();
  await vi.advanceTimersByTimeAsync(1);
  return client;
}
async function call(c: LinkClient, m: string, a: unknown, op?: string) {
  const promise = c.call(m, a, { op }).then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e: e as unknown }),
  );
  await vi.advanceTimersByTimeAsync(1);
  const result = await promise;
  if (!result.ok) throw result.e;
  return result.v;
}
describe("AI API over real memory link", () => {
  it("runs independently of connection, replays sends and returns catch-up after reconnect", async () => {
    const user = s.users[0]!,
      c = s.service.create(user, "重连");
    s.fund();
    const first = await connect(user),
      op = s.id();
    const result = await call(
      first,
      "ai.run.start",
      { conversation: c.id, text: "你好" },
      op,
    );
    expect(
      await call(
        first,
        "ai.run.start",
        { conversation: c.id, text: "你好" },
        op,
      ),
    ).toEqual(result);
    first.stop();
    await vi.advanceTimersByTimeAsync(100);
    const second = await connect(user);
    const mid = await call(second, "ai.message.page", { conversation: c.id });
    expect((mid.data as { messages: unknown[] }).messages).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000);
    const done = await call(second, "ai.message.page", { conversation: c.id });
    expect(
      (done.data as { messages: { status: string }[] }).messages[1]?.status,
    ).toBe("done");
    expect(s.service.repo.messages(c.id)).toHaveLength(2);
  });
  it("rechecks feature and admin roles and rejects cross-user access", async () => {
    const root = await connect(s.users[0]!),
      other = await connect(s.users[1]!),
      denied = await connect(s.users[2]!);
    await expect(
      call(denied, "ai.conversation.create", { title: "无权限" }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await expect(call(other, "ai.admin.stats", {})).rejects.toMatchObject({
      code: "E_DENIED",
    });
    const conv = (await call(root, "ai.conversation.create", { title: "私密" }))
      .data as { id: string };
    await expect(
      call(other, "ai.message.page", { conversation: conv.id }),
    ).rejects.toMatchObject({ code: "E_NOT_FOUND" });
  });
  it("idempotently assigns credits and queues drafts with matching operation keys", async () => {
    const c = await connect(s.users[0]!),
      key = s.id(),
      args = { user: s.users[1]!, key, amount: 10e6, days: 2, note: "充值" };
    await call(c, "ai.admin.assign", args);
    await call(c, "ai.admin.assign", args);
    expect(s.service.billing.account(s.users[1]!).topup).toBe(10e6);
    const op = s.id();
    await call(
      c,
      "ai.draft.set",
      { id: "new", value: { v: "草稿", op, t: { ms: 1, counter: 0 } } },
      op,
    );
    expect(s.service.repo.get(s.users[0]!, "aiDraft", "new")).toHaveProperty(
      "value.v",
      "草稿",
    );
    await expect(
      call(
        c,
        "ai.draft.set",
        { id: "new", value: { v: "草稿", op, t: { ms: 1, counter: 0 } } },
        s.id(),
      ),
    ).rejects.toMatchObject({ code: "E_INVALID" });
  });
});
