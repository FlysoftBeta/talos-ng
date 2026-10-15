import { describe, expect, it } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openAppDb } from "./database.ts";
import { rebuildAppData } from "./reset.ts";
describe("local reset", () => {
  it("rebuilds app stores, preserves stable device identity and leaves installed shell intact", async () => {
    const indexedDB = new IDBFactory();
    const shell = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open("talos-shell", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("installed");
      req.onsuccess = () => resolve(req.result);
    });
    const db = await openAppDb({
      indexedDB,
      keyRange: IDBKeyRange,
      channel: null,
    });
    await db.table("session").put("secret", "active");
    await db.table("outbox").put(["unsynced"], "user");
    db.close();
    await rebuildAppData("stable-device", indexedDB, undefined, IDBKeyRange);
    const rebuilt = await openAppDb({
      indexedDB,
      keyRange: IDBKeyRange,
      channel: null,
    });
    expect(await rebuilt.table("session").get("device")).toBe("stable-device");
    expect(await rebuilt.table("session").get("active")).toBeUndefined();
    expect(await rebuilt.table("outbox").count()).toBe(0);
    expect(shell.objectStoreNames.contains("installed")).toBe(true);
    rebuilt.close();
    shell.close();
  });
});
it("waits for blocked deletion, then restores the device after the other tab closes", async () => {
  const indexedDB = new IDBFactory();
  const db = await openAppDb({
    indexedDB,
    keyRange: IDBKeyRange,
    channel: null,
  });
  db.close();
  const blocker = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open("talos-app");
    request.onsuccess = () => resolve(request.result);
  });
  let blocked = false;
  await rebuildAppData(
    "preserved",
    indexedDB,
    () => {
      blocked = true;
      blocker.close();
    },
    IDBKeyRange,
  );
  expect(blocked).toBe(true);
  const rebuilt = await openAppDb({
    indexedDB,
    keyRange: IDBKeyRange,
    channel: null,
  });
  expect(await rebuilt.table("session").get("device")).toBe("preserved");
  rebuilt.close();
});
