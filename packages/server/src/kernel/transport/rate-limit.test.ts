import { describe, expect, it } from "vitest";
import { ExpensiveCallLimiter } from "./rate-limit.ts";
describe("expensive call throttling", () => {
  it.each([
    "media.search",
    "media.resolve",
    "media.prepare",
    "netbooks.search",
    "netbooks.download",
    "ai.run.start",
    "upload.begin",
    "library.doc.importText",
    "admin.incident.download",
  ])("bounds %s across connections and resets with the clock", (method) => {
    let now = 100;
    const limiter = new ExpensiveCallLimiter(() => now);
    for (let i = 0; i < 30; i++) limiter.check("user", method);
    expect(() => limiter.check("user", method)).toThrow("请求过于频繁");
    expect(() => limiter.check("other", method)).not.toThrow();
    now += 60000;
    expect(() => limiter.check("user", method)).not.toThrow();
  });
});
