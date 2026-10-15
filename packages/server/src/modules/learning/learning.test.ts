import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createUlid, deferred, fromBase64Url, utf8Decode } from "@talos/base";
import {
  createApi,
  emptyLearningProgress,
  learningCounts,
  nextLearningAnswer,
  applyLearningAnswer,
} from "@talos/contract";
import type { LearningCorpus, LearningProgress } from "@talos/contract";
import { createMemoryCarrierPair, LinkClient } from "@talos/link";
import { createMemoryObjectStore } from "@talos/objectstore";
import { createKernel } from "../../app/create-application.ts";
import type { Kernel } from "../../app/create-application.ts";
import { Db } from "../../kernel/persistence/db.ts";
const kernels: Kernel[] = [];
const clients: LinkClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.stop());
  for (const k of kernels.splice(0)) {
    await k.close();
    k.db.close();
  }
});
function setup(): Kernel {
  const kernel = createKernel({
    db: new Db(),
    store: createMemoryObjectStore(),
    build: "test",
    dev: true,
    testSeed: true,
  });
  kernels.push(kernel);
  return kernel;
}
async function connect(k: Kernel, pin = "654321") {
  const ready = deferred<void>();
  const client = new LinkClient({
    connect: async () => {
      const pair = createMemoryCarrierPair();
      k.host.link.accept(pair.b, {});
      return pair.a;
    },
    hello: () => ({ v: 1, build: "test", device: null, lang: "zh-CN" }),
  });
  clients.push(client);
  client.onWelcome(() => ready.resolve());
  client.start();
  await ready.promise;
  const api = createApi(client.call.bind(client));
  const { device } = await api.auth.device.register({});
  const session = await api.auth.login({ pin });
  if ("onboarding" in session) throw new Error("unexpected onboarding");
  return { client, api, device, user: session.user };
}
describe("learning server", () => {
  it("imports trimmed records, preserves definition hashes, skips malformed and exact duplicate English", () => {
    const k = setup();
    expect(
      k.learning.import(
        "apple#苹果￥ bad ￥ #空 ￥pear#梨#名词￥ apple #第二释义￥empty#",
      ),
    ).toMatchObject({ imported: 2, skipped: 4, total: 2 });
    const version = k.learning.repo.corpus()!.data as LearningCorpus;
    expect(k.learning.import("apple#第三释义")).toMatchObject({
      imported: 0,
      skipped: 1,
      version: version.version,
    });
    const words = JSON.parse(
      utf8Decode(inflateRawSync(fromBase64Url(version.data))),
    ) as unknown[][];
    expect(words.map((w) => w.slice(1))).toEqual([
      ["apple", "苹果"],
      ["pear", "梨#名词"],
    ]);
  });
  it("rejects oversized batches and unknown word without partial progress", () => {
    const k = setup();
    expect(() => k.learning.import("中".repeat(100000))).toThrow(
      expect.objectContaining({ code: "E_TOO_LARGE" }),
    );
    const id = createUlid()();
    expect(() =>
      k.learning.answer(
        id,
        nextLearningAnswer(emptyLearningProgress(id), id, "wrong", 1),
      ),
    ).toThrow(expect.objectContaining({ code: "E_NOT_FOUND" }));
    expect(k.learning.repo.words()).toEqual([]);
  });
  it("enforces import role, answer gate and device binding over the real memory link", async () => {
    const k = setup(),
      student = await connect(k),
      root = await connect(k, "123456"),
      id = createUlid();
    await expect(
      student.api.learning.corpus.import({ text: "apple#苹果" }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    expect(
      await root.api.learning.corpus.import({ text: "apple#苹果￥pear#梨" }),
    ).toMatchObject({ imported: 2 });
    const word = k.learning.repo.words()[0]![0];
    const answer = nextLearningAnswer(
      emptyLearningProgress(word),
      student.device,
      "correct",
      1,
    );
    await expect(
      student.api.learning.answer.record(answer),
    ).rejects.toMatchObject({ code: "E_INVALID" });
    await expect(
      student.api.learning.answer.record(
        { ...answer, device: root.device },
        { op: id() },
      ),
    ).rejects.toMatchObject({ code: "E_INVALID" });
    await student.api.learning.answer.record(answer, { op: id() });
    k.authority.setAccess(student.user.id, { features: ["offline"] });
    await expect(
      student.api.learning.answer.record(answer, { op: id() }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    const pull = await student.api.sync.pull({ cursors: { learn: 0 } });
    expect(pull.gone).toContain("learn");
    expect(pull.scopes[`me:${student.user.id}`]).toBeDefined();
  });
  it("two devices merge reordered answers, push only to owner, and replay after ops expiry safely", async () => {
    const k = setup(),
      one = await connect(k),
      two = await connect(k),
      other = await connect(k, "123456"),
      id = createUlid();
    k.learning.import("apple#苹果");
    const word = k.learning.repo.words()[0]![0];
    await one.api.sync.pull({ cursors: {} });
    await other.api.sync.pull({ cursors: {} });
    const deltas: unknown[] = [];
    other.client.on("sync.delta", (e) => deltas.push(e.data));
    let p = emptyLearningProgress(word);
    const wrong = nextLearningAnswer(p, one.device, "wrong", 1);
    p = applyLearningAnswer(p, wrong);
    const clear = nextLearningAnswer(p, two.device, "mastered", 2);
    await two.api.learning.answer.record(clear, { op: id() });
    await one.api.learning.answer.record(wrong, { op: id() });
    k.db.exec("DELETE FROM ops");
    await one.api.learning.answer.record(wrong, { op: id() });
    const progress = k.learning.repo.progress(one.user.id, word)!
      .data as LearningProgress;
    expect(learningCounts(progress)).toMatchObject({
      learned: 2,
      wrong: 0,
      answered: 2,
      mastered: true,
    });
    const pull = await one.api.sync.pull({ cursors: {} });
    expect(
      pull.scopes[`me:${one.user.id}`]!.rows.find(
        (row) => row.type === "learningProgress",
      )?.data,
    ).toEqual(progress);
    expect(JSON.stringify(deltas)).not.toContain("learningProgress");
  });
  it("syncs a realistic 3500-word corpus in one row below the header limit", async () => {
    const k = setup(),
      student = await connect(k);
    for (let start = 0; start < 3500; start += 500)
      k.learning.import(
        Array.from(
          { length: 500 },
          (_, i) => `word-${start + i}#词汇释义 ${start + i}，包含常见中文解释`,
        ).join("￥"),
      );
    const pull = await student.api.sync.pull({ cursors: {} });
    const rows = pull.scopes.learn!.rows;
    expect(rows).toHaveLength(1);
    expect((rows[0]!.data as LearningCorpus).count).toBe(3500);
    expect(Buffer.byteLength(JSON.stringify(pull))).toBeLessThan(128 * 1024);
  });
  it("retains legacy feature-manager assignment as a user-changeable preference", async () => {
    const k = setup(),
      student = await connect(k),
      root = await connect(k, "123456");
    await expect(
      student.api.learning.discipline.assign({
        user: student.user.id,
        enabled: true,
      }),
    ).rejects.toMatchObject({ code: "E_DENIED" });
    await root.api.learning.discipline.assign({
      user: student.user.id,
      enabled: true,
    });
    expect(k.me.repo.get(student.user.id, "learning.discipline")?.value.v).toBe(
      true,
    );
    await root.api.learning.discipline.assign({
      user: student.user.id,
      enabled: false,
    });
    expect(k.me.repo.get(student.user.id, "learning.discipline")?.value.v).toBe(
      false,
    );
  });
});
