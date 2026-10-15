import { describe, expect, it } from "vitest";
import { AppError, deferred } from "@talos/base";
import { ArraySource } from "./array.ts";
import { Scroller } from "../core/scroller.ts";
import type { SourceEvent } from "../core/protocol.ts";

describe("source stream", () => {
  it("answers a delayed load from the current list after intervening pushes", async () => {
    const loaded = deferred<void>();
    const source = new ArraySource(
      { key: (id: string) => id, load: () => loaded.promise },
      ["b"],
      { before: true },
    );
    const events: SourceEvent<string>[] = [];
    source.connect((event) => events.push(event));
    source.request({
      kind: "extend",
      token: 1,
      direction: "before",
      from: "b",
    });
    source.set(["a", "b"], { before: false });
    source.set(["x", "a", "b"]);
    loaded.resolve();
    await loaded.promise;
    await Promise.resolve();
    expect(events.map((event) => event.type)).toEqual([
      "insert",
      "insert",
      "extended",
    ]);
    expect(events[2]).toMatchObject({
      token: 1,
      more: false,
      items: [{ id: "x" }, { id: "a" }],
    });
  });
  it("never delivers an old connection's async replies to its replacement", async () => {
    const prepared = deferred<void>();
    const source = new ArraySource(
      { key: (id: string) => id, prepare: () => prepared.promise },
      ["a"],
    );
    const old: SourceEvent<string>[] = [],
      current: SourceEvent<string>[] = [];
    const stop = source.connect((event) => old.push(event));
    source.request({ kind: "seek", token: 1, seek: { id: "a" } });
    source.connect((event) => current.push(event));
    stop();
    prepared.resolve();
    await prepared.promise;
    await Promise.resolve();
    expect(old).toEqual([]);
    expect(current).toEqual([]);
    source.set(["a", "b"]);
    expect(current[0]?.type).toBe("insert");
  });
  it("rejects duplicate ids atomically and preserves the live list", () => {
    const source = new ArraySource({ key: (id: string) => id }, ["a"]);
    const events: SourceEvent<string>[] = [];
    source.connect((event) => events.push(event));
    expect(() => source.set(["b", "b"])).toThrow(AppError);
    expect(source.list).toEqual(["a"]);
    expect(events).toEqual([]);
    source.set(["a", "b"]);
    expect(events[0]).toMatchObject({ type: "insert", place: { after: "a" } });
  });
  it("turns a synchronous request failure into a retryable failed seek", async () => {
    const error = new AppError("E_OFFLINE", "offline");
    let failed = true;
    const array = new ArraySource({ key: (id: string) => id }, ["a"]);
    const scroller = new Scroller({
      connect: (emit) => array.connect(emit),
      request: (request) => {
        if (failed) throw error;
        array.request(request);
      },
    });
    expect(await scroller.start({ edge: "start" })).toBe("failed");
    expect(scroller.getSnapshot()).toMatchObject({ status: "failed", error });
    failed = false;
    scroller.retry();
    expect(scroller.getSnapshot().status).toBe("ready");
    expect(scroller.ids()).toEqual(["a"]);
  });
});
