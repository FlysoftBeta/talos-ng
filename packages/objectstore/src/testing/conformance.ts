import assert from "node:assert/strict";
import { AppError, concat, utf8Encode } from "@talos/base";
import { hashStream } from "../content/stream.ts";
import type { ObjectStore } from "../ports.ts";

/** Each test gets an isolated store, a controllable wall clock, and cleanup. */
export interface ConformanceFixture {
  store: ObjectStore;
  advanceTime(ms: number): void;
  dispose(): Promise<void>;
}
export interface ConformanceTest {
  name: string;
  run(): Promise<void>;
}
export type ConformanceFactory = () =>
  ConformanceFixture | Promise<ConformanceFixture>;
export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}
function code(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof AppError && error.code === expected;
}
const bytes = utf8Encode("hello object store");
const missing = "0".repeat(64);

/** Runner-neutral: register each returned test with Vitest, node:test, or another runner. */
export function objectStoreConformanceTests(
  factory: ConformanceFactory,
): ConformanceTest[] {
  type Check = (fixture: ConformanceFixture) => Promise<void>;
  const cases: [string, Check][] = [
    [
      "empty store and missing objects",
      async ({ store }) => {
        assert.equal(await store.has(missing), false);
        assert.equal(await store.stat(missing), null);
        assert.equal(await store.verify(missing), false);
        assert.equal(await store.delete(missing), false);
        assert.deepEqual(await collect(store.list()), []);
        await assert.rejects(store.open(missing), code("E_NOT_FOUND"));
        await assert.rejects(store.readAll(missing), code("E_NOT_FOUND"));
      },
    ],
    [
      "put, stat, read and verify",
      async ({ store }) => {
        const info = await store.put(bytes);
        assert.deepEqual(info, await hashStream(bytes));
        assert.equal(await store.has(info.id), true);
        assert.equal((await store.stat(info.id))?.size, bytes.length);
        assert.equal(await store.verify(info.id), true);
        assert.deepEqual(await store.readAll(info.id), bytes);
      },
    ],
    [
      "empty objects and zero-length ranges",
      async ({ store }) => {
        const info = await store.put(new Uint8Array());
        assert.deepEqual(await store.readAll(info.id), new Uint8Array());
        assert.deepEqual(
          await collect(store.read(info.id, { start: 0, end: 0 })),
          [],
        );
        const reader = await store.open(info.id);
        try {
          assert.deepEqual(await reader.read(0, 0), new Uint8Array());
        } finally {
          await reader.close();
        }
      },
    ],
    [
      "chunked input, dedup and stable modification time",
      async ({ store, advanceTime }) => {
        const info = await store.put(bytes),
          before = await store.stat(info.id);
        advanceTime(1000);
        async function* src() {
          yield bytes.subarray(0, 3);
          yield new Uint8Array();
          yield bytes.subarray(3);
        }
        assert.deepEqual(await store.put(src()), info);
        assert.deepEqual(await store.stat(info.id), before);
        assert.equal((await collect(store.list())).length, 1);
      },
    ],
    [
      "expected hash and size",
      async ({ store }) => {
        const info = await hashStream(bytes);
        assert.deepEqual(await store.put(bytes, info), info);
      },
    ],
    [
      "mismatching hash does not publish",
      async ({ store }) => {
        await assert.rejects(
          store.put(bytes, { id: missing }),
          code("E_INTEGRITY"),
        );
        assert.deepEqual(await collect(store.list()), []);
      },
    ],
    [
      "mismatching size does not publish",
      async ({ store }) => {
        await assert.rejects(
          store.put(bytes, { size: bytes.length + 1 }),
          code("E_INTEGRITY"),
        );
        assert.deepEqual(await collect(store.list()), []);
      },
    ],
    [
      "failed input stream publishes nothing",
      async ({ store }) => {
        async function* src() {
          yield bytes;
          throw new Error("source failure");
        }
        await assert.rejects(store.put(src()), code("E_INTERNAL"));
        assert.deepEqual(await collect(store.list()), []);
      },
    ],
    [
      "invalid stream chunks are rejected",
      async ({ store }) => {
        async function* src() {
          yield "invalid" as unknown as Uint8Array;
        }
        await assert.rejects(store.put(src()), code("E_INVALID"));
        assert.deepEqual(await collect(store.list()), []);
      },
    ],
    [
      "randomized ranges and chunk boundaries",
      async ({ store }) => {
        let seed = 1234;
        const next = (): number => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return seed;
        };
        const data = Uint8Array.from({ length: 300_007 }, () => next() & 255);
        async function* src() {
          for (let at = 0; at < data.length;) {
            const end = Math.min(data.length, at + 1 + (next() % 20_000));
            yield data.subarray(at, end);
            at = end;
          }
        }
        const info = await store.put(src());
        const reader = await store.open(info.id);
        try {
          for (let i = 0; i < 35; i++) {
            const a = next() % (data.length + 1),
              b = next() % (data.length + 1);
            const start = Math.min(a, b),
              end = Math.max(a, b);
            assert.deepEqual(
              await store.readAll(info.id, { start, end }),
              data.slice(start, end),
            );
            assert.deepEqual(
              await reader.read(start, end - start),
              data.slice(start, end),
            );
          }
        } finally {
          await reader.close();
        }
        const parts = await collect(store.read(info.id));
        assert.deepEqual(concat(...parts), data);
        for (const part of parts.slice(0, -1))
          assert.ok(part.length >= 64 * 1024 && part.length <= 256 * 1024);
      },
    ],
    [
      "invalid ranges and random access bounds",
      async ({ store }) => {
        const info = await store.put(bytes),
          reader = await store.open(info.id);
        try {
          for (const range of [
            { start: -1, end: 1 },
            { start: 3, end: 2 },
            { start: 0, end: bytes.length + 1 },
            { start: 0.1, end: 2 },
            { start: 0, end: Infinity },
            { start: NaN, end: 1 },
          ])
            await assert.rejects(
              store.readAll(info.id, range),
              code("E_INVALID"),
            );
          for (const [offset, length] of [
            [-1, 1],
            [0, -1],
            [bytes.length, 1],
            [0, NaN],
            [Number.MAX_SAFE_INTEGER, 1],
          ] as const)
            await assert.rejects(
              reader.read(offset, length),
              code("E_INVALID"),
            );
        } finally {
          await reader.close();
        }
        await reader.close();
        await assert.rejects(reader.read(0, 1), code("E_CONFLICT"));
      },
    ],
    [
      "read buffers and input bytes are isolated",
      async ({ store }) => {
        const input = new Uint8Array(bytes),
          info = await store.put(input);
        input.fill(0);
        (await store.readAll(info.id)).fill(0);
        assert.deepEqual(await store.readAll(info.id), bytes);
      },
    ],
    [
      "stage resume and commit",
      async ({ store }) => {
        const stage = await store.stage("resume");
        assert.equal(stage.size, 0);
        assert.equal(await stage.append(bytes.subarray(0, 4), 0), 4);
        const reopened = await store.stage("resume");
        assert.equal(reopened.size, 4);
        assert.equal(await reopened.append(bytes.subarray(4), 4), bytes.length);
        assert.equal(stage.size, bytes.length);
        const info = await reopened.commit(await hashStream(bytes));
        assert.deepEqual(await store.readAll(info.id), bytes);
        await assert.rejects(
          stage.append(bytes, stage.size),
          code("E_CONFLICT"),
        );
        await assert.rejects(stage.commit(), code("E_CONFLICT"));
      },
    ],
    [
      "stage offset conflicts carry actual size",
      async ({ store }) => {
        const stage = await store.stage("offset");
        await stage.append(bytes, 0);
        await assert.rejects(stage.append(bytes, 0), (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, "E_CONFLICT");
          assert.deepEqual(error.data, { size: bytes.length });
          return true;
        });
        assert.equal(stage.size, bytes.length);
      },
    ],
    [
      "stage mismatch is resumable",
      async ({ store }) => {
        const stage = await store.stage("mismatch");
        await stage.append(bytes, 0);
        await assert.rejects(stage.commit({ size: 0 }), code("E_INTEGRITY"));
        await assert.rejects(
          stage.commit({ id: missing }),
          code("E_INTEGRITY"),
        );
        assert.deepEqual(await collect(store.list()), []);
        assert.equal((await store.stage("mismatch")).size, bytes.length);
        assert.deepEqual(await stage.commit(), await hashStream(bytes));
      },
    ],
    [
      "abort is idempotent and old handles cannot affect reused ids",
      async ({ store }) => {
        const old = await store.stage("reuse");
        await old.append(bytes, 0);
        await old.abort();
        await old.abort();
        const fresh = await store.stage("reuse");
        assert.equal(fresh.size, 0);
        await old.abort();
        await assert.rejects(old.append(bytes, 0), code("E_CONFLICT"));
        await fresh.append(bytes, 0);
        await fresh.commit();
      },
    ],
    [
      "empty and duplicate stage commits",
      async ({ store }) => {
        const first = await store.put(new Uint8Array());
        assert.deepEqual(await (await store.stage("empty")).commit(), first);
        const a = await store.stage("a"),
          b = await store.stage("b");
        await a.append(bytes, 0);
        await b.append(bytes, 0);
        assert.deepEqual(await a.commit(), await b.commit());
        assert.equal((await collect(store.list())).length, 2);
      },
    ],
    [
      "parallel same-content and distinct puts",
      async ({ store }) => {
        const inputs = Array.from({ length: 24 }, (_, i) =>
          i % 2 ? bytes : Uint8Array.of(i),
        );
        const infos = await Promise.all(inputs.map((data) => store.put(data)));
        assert.equal((await collect(store.list())).length, 13);
        for (let i = 0; i < inputs.length; i++)
          assert.deepEqual(await store.readAll(infos[i]!.id), inputs[i]);
      },
    ],
    [
      "parallel stage appends serialize and report conflicts",
      async ({ store }) => {
        const handles = await Promise.all(
          Array.from({ length: 12 }, () => store.stage("parallel")),
        );
        const results = await Promise.allSettled(
          handles.map((stage) => stage.append(bytes, 0)),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        for (const result of results)
          if (result.status === "rejected") {
            assert.ok(result.reason instanceof AppError);
            assert.equal(result.reason.code, "E_CONFLICT");
            assert.deepEqual(result.reason.data, { size: bytes.length });
          }
        assert.deepEqual(await handles[0]!.commit(), await hashStream(bytes));
      },
    ],
    [
      "queued appends, commit and abort are ordered",
      async ({ store }) => {
        const stage = await store.stage("ordered");
        const a = stage.append(Uint8Array.of(1), 0),
          b = stage.append(Uint8Array.of(2), 1),
          commit = stage.commit(),
          abort = stage.abort();
        await Promise.all([a, b, abort]);
        assert.deepEqual(
          await store.readAll((await commit).id),
          Uint8Array.of(1, 2),
        );
      },
    ],
    [
      "list, usage and delete",
      async ({ store }) => {
        const a = await store.put(bytes),
          b = await store.put(Uint8Array.of(2));
        assert.deepEqual(
          new Set((await collect(store.list())).map((item) => item.id)),
          new Set([a.id, b.id]),
        );
        if (store.usage)
          assert.deepEqual(await store.usage(), {
            objects: 2,
            bytes: bytes.length + 1,
          });
        assert.equal(await store.delete(a.id), true);
        assert.equal(await store.delete(a.id), false);
        assert.equal(await store.has(a.id), false);
        assert.deepEqual(await store.readAll(b.id), Uint8Array.of(2));
      },
    ],
    [
      "open reader completes across deletion",
      async ({ store }) => {
        const info = await store.put(bytes),
          reader = await store.open(info.id);
        try {
          await store.delete(info.id);
          assert.deepEqual(await reader.read(0, bytes.length), bytes);
        } finally {
          await reader.close();
        }
      },
    ],
    [
      "sweep stages respects age and append mtime",
      async ({ store, advanceTime }) => {
        const old = await store.stage("old"),
          refreshed = await store.stage("refreshed");
        advanceTime(2000);
        await refreshed.append(bytes, 0);
        assert.equal(await store.sweepStages(1000), 1);
        await assert.rejects(old.commit(), code("E_CONFLICT"));
        assert.equal((await store.stage("old")).size, 0);
        assert.equal((await store.stage("refreshed")).size, bytes.length);
        assert.equal(await store.sweepStages(0), 0);
        advanceTime(2000);
        assert.equal(await store.sweepStages(1000), 2);
        assert.equal(await store.sweepStages(1000), 0);
        if (store.sweepTrash) assert.equal(await store.sweepTrash(), 0);
      },
    ],
    [
      "invalid ids reject on all entry points",
      async ({ store }) => {
        for (const id of [
          "",
          "../escape",
          "a".repeat(63),
          "a".repeat(65),
          "A".repeat(64),
          "g".repeat(64),
          "a".repeat(64) + "\n",
          "C:\\escape",
          "../" + "0".repeat(64),
        ]) {
          for (const op of [
            () => store.has(id),
            () => store.stat(id),
            () => store.open(id),
            () => store.delete(id),
            () => store.readAll(id),
            () => store.verify(id),
            () => store.put(bytes, { id }),
          ])
            await assert.rejects(op(), code("E_INVALID"));
          assert.throws(() => store.localPath(id), code("E_INVALID"));
        }
      },
    ],
    [
      "stage id validation",
      async ({ store }) => {
        for (const id of [
          "",
          ".",
          "..",
          "a/b",
          "a\\b",
          "a".repeat(65),
          "abc\n",
          "x.json",
          "x\0",
        ])
          await assert.rejects(store.stage(id), code("E_INVALID"));
        await (await store.stage("A_z-09")).abort();
        await (await store.stage("a".repeat(64))).abort();
      },
    ],
    [
      "invalid sizes and stage arguments",
      async ({ store }) => {
        const stage = await store.stage("invalid");
        for (const size of [
          -1,
          NaN,
          Infinity,
          1.5,
          Number.MAX_SAFE_INTEGER + 1,
        ]) {
          await assert.rejects(store.put(bytes, { size }), code("E_INVALID"));
          await assert.rejects(stage.commit({ size }), code("E_INVALID"));
          await assert.rejects(stage.append(bytes, size), code("E_INVALID"));
          await assert.rejects(store.sweepStages(size), code("E_INVALID"));
        }
        await assert.rejects(
          stage.append("bad" as unknown as Uint8Array, 0),
          code("E_INVALID"),
        );
        assert.equal(stage.size, 0);
      },
    ],
  ];
  return cases.map(([name, check]) => ({
    name,
    async run() {
      const fixture = await factory();
      try {
        await check(fixture);
      } finally {
        await fixture.dispose();
      }
    },
  }));
}
