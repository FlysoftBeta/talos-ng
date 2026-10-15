import { describe, expect, it } from "vitest";
import {
  contract,
  createApi,
  methodRegistry,
  methods,
  rolesWithDependencies,
  FEATURES,
  idSchema,
} from "./index.ts";
describe("contract registry", () => {
  it("is frozen, uniquely names methods, and includes legacy gates", () => {
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.auth)).toBe(true);
    expect(new Set(methods.map((method) => method.name)).size).toBe(
      methods.length,
    );
    expect(Object.keys(methodRegistry)).toHaveLength(methods.length);
    expect(FEATURES).toHaveLength(9);
  });
  it("enforces PIN, strict args and operation stamps", () => {
    expect(idSchema.safeParse("Z1ARZ3NDEKTSV4RRFFQ69G5FAV").success).toBe(
      false,
    );
    expect(contract.auth.login.args.safeParse({ pin: "123456" }).success).toBe(
      true,
    );
    expect(contract.auth.login.args.safeParse({ pin: "12345" }).success).toBe(
      false,
    );
    expect(
      contract.auth.login.args.safeParse({ pin: "123456", admin: true })
        .success,
    ).toBe(false);
    expect(contract.me.setting.set.offline).toBe("queue");
    expect(
      contract.me.setting.set.args.safeParse({
        key: "theme",
        value: {
          v: "dark",
          t: { ms: -1, counter: 0 },
          op: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        },
      }).success,
    ).toBe(false);
  });
  it("expands role dependencies in stable order", () => {
    expect(rolesWithDependencies(["advanced_community_manager"])).toEqual([
      "administrator",
      "community_manager",
      "advanced_community_manager",
    ]);
    expect(rolesWithDependencies(["root", "administrator"])).toEqual([
      "administrator",
      "root",
    ]);
  });
  it("creates typed calls forwarding options and validating replies", async () => {
    const calls: unknown[] = [];
    const api = createApi(async (...args) => {
      calls.push(args);
      return { data: { now: 10 }, body: new Uint8Array() };
    });
    expect(await api.sys.time({}, { timeoutMs: 100 })).toEqual({ now: 10 });
    expect(calls).toEqual([["sys.time", {}, { timeoutMs: 100 }]]);
    await expect(api.auth.login({ pin: "invalid" })).rejects.toThrow();
    expect(calls).toHaveLength(1);
    await expect(api.sys.info({})).rejects.toThrow();
  });
});
