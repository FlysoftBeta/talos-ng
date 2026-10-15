import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@talos/base";
import { KV } from "@talos/store";
import type { Database } from "@talos/store";
// The store package explicitly exports this public, fake-IDB-only testing adapter.
// eslint-disable-next-line boundaries/imports
import { createTestEnvironment } from "@talos/store/testing";
import { createNav, navReducer, restoreNav } from "./nav.ts";
import { KvNavPersistence } from "./persistence.ts";

describe("KV navigation persistence", () => {
  let db: Database;
  let kv: KV;
  let adapter: KvNavPersistence;
  beforeEach(async () => {
    db = await createTestEnvironment().open({
      name: "nav-test",
      schema: [
        {
          version: 1,
          upgrade(transaction) {
            transaction.db.createObjectStore("kv");
          },
        },
      ],
    });
    kv = new KV(db);
    adapter = new KvNavPersistence(kv);
  });
  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });
  it("persists JSON strings in IndexedDB and restores independent per-user states", async () => {
    const first = navReducer(createNav(), {
      type: "openConversation",
      id: "conversation-a",
    });
    const second = navReducer(createNav(), {
      type: "openDocument",
      id: "document-b",
    });
    await adapter.save("user-a", first);
    await adapter.save("user-b", second);
    expect(await kv.get("nav:v1:user-a")).toBe(JSON.stringify(first));
    expect(await restoreNav(adapter, "user-a")).toEqual(first);
    expect(await restoreNav(adapter, "user-b")).toEqual(second);
    const loaded = await adapter.load("user-a");
    expect(loaded).not.toBe(first);
    await adapter.remove("user-a");
    expect(await adapter.load("user-a")).toBeUndefined();
    expect(await adapter.load("user-b")).toEqual(second);
  });
  it.each(["not json", "null", '{"area":"chat"}', 42])(
    "rejects corrupted storage %j",
    async (value) => {
      await kv.set("nav:v1:user", value);
      await expect(adapter.load("user")).rejects.toMatchObject({
        code: "E_INTEGRITY",
      });
    },
  );
  it("rejects malformed saves and empty users without writing", async () => {
    await expect(
      adapter.save("user", { ...createNav(), area: "invalid" } as never),
    ).rejects.toMatchObject({ code: "E_INVALID" });
    await expect(adapter.save(" ", createNav())).rejects.toMatchObject({
      code: "E_INVALID",
    });
    await expect(adapter.load("")).rejects.toMatchObject({ code: "E_INVALID" });
    await expect(adapter.remove("")).rejects.toMatchObject({
      code: "E_INVALID",
    });
    expect(await adapter.load("user")).toBeUndefined();
  });
  it("preserves store AppError codes and normalizes unexpected storage errors", async () => {
    const error = new AppError("E_TOO_LARGE", "容量不足");
    vi.spyOn(kv, "set").mockRejectedValue(error);
    await expect(adapter.save("user", createNav())).rejects.toBe(error);
    vi.spyOn(kv, "get").mockRejectedValue(new Error("unknown"));
    await expect(adapter.load("user")).rejects.toMatchObject({
      code: "E_UNAVAILABLE",
    });
  });
});
