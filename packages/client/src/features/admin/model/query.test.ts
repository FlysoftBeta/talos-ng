import { describe, expect, it } from "vitest";
import { QueryResource } from "./query.ts";
import type { LoadState } from "./query.ts";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("QueryResource", () => {
  it("ignores an answer that a newer request has superseded", async () => {
    const seen: LoadState<string>[] = [];
    const resource = new QueryResource<string>((s) => seen.push(s));
    const first = deferred<string>();
    const second = deferred<string>();
    resource.run(() => first.promise);
    resource.run(() => second.promise);
    second.resolve("new");
    await flush();
    first.resolve("old");
    await flush();
    expect(resource.state).toEqual({ data: "new", loading: false, error: "" });
  });
  it("reports the failure and keeps earlier data; reload repeats the last request", async () => {
    const resource = new QueryResource<number>(() => {});
    let attempt = 0;
    resource.run(async () => {
      attempt++;
      if (attempt === 2) throw new Error("下线");
      return attempt;
    });
    await flush();
    expect(resource.state.data).toBe(1);
    resource.reload();
    await flush();
    expect(resource.state).toEqual({ data: 1, loading: false, error: "下线" });
  });
  it("drops pending answers after cancel or settle", async () => {
    const resource = new QueryResource<string>(() => {});
    const late = deferred<string>();
    resource.run(() => late.promise);
    resource.cancel();
    late.resolve("late");
    await flush();
    expect(resource.state.data).toBeUndefined();
    resource.settle("empty");
    expect(resource.state).toEqual({
      data: "empty",
      loading: false,
      error: "",
    });
  });
});
