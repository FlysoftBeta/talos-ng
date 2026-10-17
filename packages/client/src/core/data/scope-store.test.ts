import { describe, expect, it } from "vitest";
import { deferred } from "@talos/base";
import type { LockManagerLike } from "@talos/store";
import { ScopeLocks } from "./scope-store.ts";

/** Exclusive named locks granted in request order, like the Web Locks API. */
class Locks implements LockManagerLike {
  readonly requested: string[] = [];
  private readonly tails = new Map<string, Promise<unknown>>();
  request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    this.requested.push(name);
    const previous = this.tails.get(name) ?? Promise.resolve();
    const run = previous.then(callback, callback);
    this.tails.set(
      name,
      run.catch(() => undefined),
    );
    return run;
  }
}

describe("scope writer locks", () => {
  it("serializes writers of overlapping scopes and takes locks in sorted order", async () => {
    const locks = new Locks();
    const writer = new ScopeLocks(locks);
    const order: string[] = [];
    const release = deferred<void>();
    const first = writer.run(["conv:b", "conv:a"], async () => {
      order.push("first:start");
      await release.promise;
      order.push("first:end");
    });
    const second = writer.run(["conv:c", "conv:a"], async () => {
      order.push("second");
    });
    const disjoint = writer.run(["me:u"], async () => {
      order.push("disjoint");
    });
    await disjoint;
    release.resolve();
    await Promise.all([first, second]);
    // The disjoint scope never waited for the held one; the overlapping one did.
    expect(order.indexOf("disjoint")).toBeLessThan(order.indexOf("first:end"));
    expect(order.filter((step) => step !== "disjoint")).toEqual([
      "first:start",
      "first:end",
      "second",
    ]);
    // Each writer requests its scopes in sorted order, one after the other.
    expect(
      locks.requested.filter((name) => name !== "talos-sync:me:u"),
    ).toEqual([
      "talos-sync:conv:a",
      "talos-sync:conv:a",
      "talos-sync:conv:b",
      "talos-sync:conv:c",
    ]);
  });

  it("falls back to the transaction as the only serialization without Web Locks", async () => {
    const writer = new ScopeLocks(null);
    await expect(writer.run(["a"], async () => 7)).resolves.toBe(7);
  });
});
