import { describe, expect, it } from "vitest";
import { ModuleRegistry, defineClientModule } from "./modules.ts";
import { settingsModule } from "../../features/settings/module.ts";
import { Repository } from "./repository.ts";
import { sessionGate } from "../auth/session.ts";
import type { Gate, GateEvent } from "../auth/session.ts";
import type { OutboxItem } from "@talos/sync";
const args = {
  key: "theme",
  value: {
    v: "dark",
    t: { ms: 1, counter: 0 },
    op: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  },
};
const op: OutboxItem = {
  op: "a",
  method: "me.setting.set",
  args,
  createdAt: 1,
  state: "pending",
  attempts: 0,
};
describe("client modules and repositories", () => {
  it("projects registered optimistic reducers without overwriting authoritative rows", () => {
    const registry = new ModuleRegistry([settingsModule]);
    const base = [
      {
        scope: "me:u",
        type: "setting",
        id: "theme",
        deleted: false,
        rev: 1,
        data: {
          id: "theme",
          key: "theme",
          value: { ...args.value, v: "light", t: { ms: 0, counter: 0 } },
        },
      },
    ];
    const view = registry.project(base, [op], "u");
    expect((view[0]!.data as (typeof base)[0]["data"]).value.v).toBe("dark");
    expect(base[0]!.data.value.v).toBe("light");
    expect(registry.project(base, [{ ...op, state: "failed" }], "u")).toEqual(
      base,
    );
  });
  it("rejects duplicate module ids and queued method handlers", () => {
    expect(
      () => new ModuleRegistry([settingsModule, settingsModule]),
    ).toThrow();
    expect(
      () =>
        new ModuleRegistry([
          settingsModule,
          defineClientModule({ ...settingsModule, id: "other" }),
        ]),
    ).toThrow();
  });
  it("publishes stable external-store snapshots and unsubscribe is effective", () => {
    const repo = new Repository((rows) => rows.map((row) => row.id));
    let changes = 0;
    const off = repo.subscribe(() => changes++);
    expect(repo.getSnapshot()).toBe(repo.getSnapshot());
    repo.hydrate([]);
    expect(changes).toBe(1);
    off();
    repo.hydrate([]);
    expect(changes).toBe(1);
  });
  it("ignores corrupt persisted intent in projection so the server can reject it", () => {
    expect(
      new ModuleRegistry([settingsModule]).project(
        [],
        [{ ...op, args: {} }],
        "u",
      ),
    ).toEqual([]);
  });
});
describe("gate reducer", () => {
  it.each([
    ["boot", "restore", "appLocked"],
    ["boot", "admitted", "signedOut"],
    ["app", "lock", "appLocked"],
    ["appLocked", "unlock", "app"],
    ["signedOut", "login", "app"],
    ["signedOut", "onboard", "onboarding"],
    ["onboarding", "login", "app"],
    ["app", "denied", "deviceLocked"],
  ] as [Gate, GateEvent, Gate][])("%s + %s -> %s", (gate, event, next) =>
    expect(sessionGate(gate, event)).toBe(next),
  );
  it("cannot unlock a signed-out or denied device by a concealment intent", () => {
    expect(sessionGate("signedOut", "unlock")).toBe("signedOut");
    expect(sessionGate("deviceLocked", "unlock")).toBe("deviceLocked");
  });
});
