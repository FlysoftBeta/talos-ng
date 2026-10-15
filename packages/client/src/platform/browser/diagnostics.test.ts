import { installDiagnostics } from "./diagnostics.ts";
import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { BrowserDiagnostics } from "../../core/status/diagnostics.ts";
import type { ClientIncident } from "../../core/status/diagnostics.ts";
import { openAppDb } from "../storage/database.ts";
it("captures browser errors/rejections, bounds and redacts IndexedDB reports, replays after restart", async () => {
  const db = await openAppDb({ name: "diagnostics-test" });
  let online = false;
  let user: string | undefined = "alice";
  const received: ClientIncident[] = [];
  const store = {
    user: () => user,
    online: () => online,
    read: async (id: string) =>
      (await db.table<ClientIncident[], string>("kv").get(id)) ?? [],
    write: async (id: string, rows: ClientIncident[]) => {
      await db.table<ClientIncident[], string>("kv").put(rows, id);
    },
    send: async (row: ClientIncident) => {
      received.push(row);
    },
  };
  const capture = new BrowserDiagnostics(
    store,
    "a".repeat(40),
    () => "Chrome/70 device/test",
  );
  const cleanup = installDiagnostics(capture);
  try {
    const error = new Error("PIN 123456 token TOPSECRET");
    error.stack =
      "Error: TOPSECRET\n at widget (https://host/app.js?token=TOPSECRET)\n at pin=123456 token=TOPSECRET" +
      "\n at " +
      "123456 ".repeat(400);
    window.dispatchEvent(new ErrorEvent("error", { error }));
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: error });
    window.dispatchEvent(rejection);
    await capture.flush();
    expect((await store.read("alice")).map((r) => r.kind)).toEqual([
      "error",
      "unhandledrejection",
    ]);
    for (let i = 0; i < 100; i++) capture.capture(error, "operation");
    await capture.flush();
    const rows = await store.read("alice");
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.stack.length <= 2048)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/123456|TOPSECRET/);
    expect(JSON.stringify(rows).length).toBeLessThan(60_000);
    const restarted = new BrowserDiagnostics(
      store,
      "new-build",
      () => "unused",
    );
    user = "bob";
    online = true;
    await restarted.flush();
    expect(received).toHaveLength(0);
    user = "alice";
    await restarted.flush();
    expect(received).toHaveLength(20);
    expect(received[0]?.build).toBe("a".repeat(40));
    expect(await store.read("alice")).toEqual([]);
  } finally {
    cleanup();
    db.close();
  }
});
