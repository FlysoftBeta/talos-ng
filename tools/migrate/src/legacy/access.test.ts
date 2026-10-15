import { expect, it } from "vitest";
import { grants, grantPolicy, type LegacyGrant } from "./access.ts";
it("decodes actual legacy object grants and rejects malformed modes", () => {
  expect(grants('[{"mode":"readwrite","shareable":true}]')).toEqual([
    { mode: "readwrite", shareable: true },
  ]);
  expect(() => grants('["read"]')).toThrow("Invalid legacy grant mode");
  expect(() => grants('[ {"mode":"read","shareable":"false"} ]')).toThrow(
    "Invalid legacy shareable flag",
  );
  expect(() => grantPolicy([])).toThrow("Empty legacy grant set");
});
it("preserves access without escalating delegation for every possible legacy grant union", () => {
  const candidates: LegacyGrant[] = [
    { mode: "owner" },
    { mode: "readwrite", shareable: false },
    { mode: "readwrite", shareable: true },
    { mode: "read", shareable: false },
    { mode: "read", shareable: true },
  ];
  for (let mask = 1; mask < 32; mask++) {
    const set = candidates.filter((_, index) => !!(mask & (1 << index))),
      policy = grantPolicy(set);
    const rank = { read: 1, write: 2, own: 3 };
    const access = Math.max(
      ...set.map((g) =>
        g.mode === "owner" ? 3 : g.mode === "readwrite" ? 2 : 1,
      ),
    );
    const share = Math.max(
      0,
      ...set.map((g) =>
        g.mode === "owner"
          ? 3
          : g.shareable
            ? g.mode === "readwrite"
              ? 2
              : 1
            : 0,
      ),
    );
    expect(rank[policy.level]).toBe(access);
    expect(policy.delegable).toBe(share >= access);
    expect(policy.lossy).toBe(access === 2 && share === 1);
  }
});
