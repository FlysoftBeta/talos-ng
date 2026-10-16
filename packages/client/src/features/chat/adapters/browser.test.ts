import { afterEach, expect, it, vi } from "vitest";
import { copyText } from "./browser.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it.each([
  undefined,
  {
    writeText: async () => {
      throw new Error("denied");
    },
  },
])(
  "falls back when clipboard is unavailable or denied and restores focus/selection",
  async (clipboard) => {
    vi.stubGlobal("navigator", { clipboard });
    const button = document.createElement("button");
    button.textContent = "message";
    document.body.appendChild(button);
    button.focus();
    const range = document.createRange();
    range.selectNodeContents(button);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    const copy = vi.fn(() => {
      expect(document.querySelector("textarea")!.value).toBe("hello\nworld");
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: copy,
    });
    try {
      await copyText("hello\nworld");
      expect(copy).toHaveBeenCalledWith("copy");
      expect(document.querySelector("textarea")).toBeNull();
      expect(document.activeElement).toBe(button);
      expect(document.getSelection()!.toString()).toBe("message");
    } finally {
      Reflect.deleteProperty(document, "execCommand");
    }
  },
);

it("reports failure and cleans up when legacy copy is unavailable", async () => {
  vi.stubGlobal("navigator", {});
  await expect(copyText("hello")).rejects.toMatchObject({
    code: "E_UNAVAILABLE",
  });
  expect(document.querySelector("textarea")).toBeNull();
});

it("uses the native clipboard when available", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await copyText("hello");
  expect(writeText).toHaveBeenCalledWith("hello");
  expect(document.querySelector("textarea")).toBeNull();
});
