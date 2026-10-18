import { describe, expect, it } from "vitest";
import { AppError } from "./errors.ts";
import { diagnosticError, diagnosticText } from "./diagnostics.ts";

describe("diagnostics", () => {
  it("keeps minified stack positions but redacts loose six-digit codes", () => {
    expect(
      diagnosticText("at f (https://h/app/b/main-x.js:9:123456)"),
    ).toContain(":9:123456");
    expect(diagnosticText("code 123456")).toBe("code [redacted]");
  });
  it("names AppErrors by code without the message", () => {
    const e = diagnosticError(new AppError("E_DENIED", "secret message"));
    expect(e.name).toBe("AppError[E_DENIED]");
    expect(JSON.stringify(e)).not.toContain("secret");
  });
});
