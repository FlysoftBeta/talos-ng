import { expect, it, vi } from "vitest";
import { assignCredits } from "./credit-batch.ts";
it("continues after individual failures and retries an ambiguous assignment with the same fingerprint", async () => {
  const assignments = ["a", "b", "c"].map((user) => ({
    user,
    key: `key-${user}`,
    amount: 1_000_000,
    days: 30,
    note: "班级",
  }));
  const applied = new Map<string, number>();
  let lost = false;
  const call = vi.fn(async (args: (typeof assignments)[number]) => {
    if (!applied.has(args.key)) applied.set(args.key, args.amount);
    if (args.user === "b" && !lost) {
      lost = true;
      throw new Error("连接中断");
    }
  });
  const results = await assignCredits(assignments, call);
  expect(results.map((r) => r.ok)).toEqual([true, false, true]);
  const retry = await assignCredits(
    results.filter((r) => !r.ok).map((r) => r.assignment),
    call,
  );
  expect(retry[0]?.ok).toBe(true);
  expect(call.mock.calls.map(([a]) => a.key)).toEqual([
    "key-a",
    "key-b",
    "key-c",
    "key-b",
  ]);
  expect([...applied.values()]).toEqual([1_000_000, 1_000_000, 1_000_000]);
});
