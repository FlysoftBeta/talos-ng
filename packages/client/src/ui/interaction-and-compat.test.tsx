import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { AppError } from "@talos/base";
import { tokens } from "./theme/tokens.ts";
import { TalosProvider, assertSafeCss } from "./theme/theme.tsx";
import { Button } from "./actions/button.tsx";
import { Dialog } from "./overlays/overlays.tsx";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render(node: ReactNode) {
  await act(async () => root.render(<TalosProvider>{node}</TalosProvider>));
}
async function click(node: Element | null) {
  expect(node).toBeTruthy();
  await act(async () => {
    (node as HTMLElement).click();
  });
}
describe("overlays and status", () => {
  it("tracks keyboard and pointer focus without requiring native focus-visible", async () => {
    await render(<button>操作</button>);
    const surface = host.querySelector(".talos")!;
    const button = host.querySelector("button")!;
    expect(surface.getAttribute("data-focus")).toBe("keyboard");
    await act(async () => {
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(surface.getAttribute("data-focus")).toBe("pointer");
    await act(async () => {
      button.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(surface.getAttribute("data-focus")).toBe("keyboard");
  });
  it("traps Tab and Shift+Tab, handles Escape and restores focus", async () => {
    const close = vi.fn();
    const prior = document.createElement("button");
    document.body.appendChild(prior);
    prior.focus();
    await render(
      <Dialog open title="详细信息" onClose={close}>
        <button>确定</button>
      </Dialog>,
    );
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.activeElement).toBe(dialog);
    prior.focus();
    expect(document.activeElement).toBe(dialog);
    const buttons = dialog.querySelectorAll("button");
    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => {
      buttons[0]!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(buttons[1]);
    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(close).toHaveBeenCalledOnce();
    await render(null);
    expect(document.activeElement).toBe(prior);
    prior.remove();
  });
});
describe("compatibility and contrast", () => {
  it.each([
    "gap: 4px",
    "row-gap: 2px",
    "inset: 0",
    "aspect-ratio: 1",
    "width: clamp(1px,2px,3px)",
    "width: min(10px,20px)",
    ":where(.a)",
    ":is(.a)",
    "backdrop-filter: blur(2px)",
  ])("rejects %s", (css) => expect(() => assertSafeCss(css)).toThrow(AppError));
  it("accepts margin spacing and calc", () =>
    expect(() =>
      assertSafeCss("margin-left: 4px; width: calc(100% - 8px)"),
    ).not.toThrow());
  function luminance(hex: string) {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
  }
  for (const [mode, p] of Object.entries(tokens.palettes))
    for (const ink of [
      "text",
      "muted",
      "accent",
      "pending",
      "failed",
      "confirmed",
    ] as const)
      for (const bg of [
        "bg",
        "sidebar",
        "raised",
        "hover",
        "selected",
      ] as const)
        it(`${mode} ${ink} on ${bg} meets AA text contrast`, () => {
          const a = luminance(p[ink]),
            b = luminance(p[bg]);
          expect(
            (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          ).toBeGreaterThanOrEqual(4.5);
        });
});

it("requires acknowledgement for a nondismissible dialog", async () => {
  const close = vi.fn();
  await render(
    <Dialog open title="系统公告" dismissible={false} onClose={close}>
      <Button onClick={close}>我已阅读并确认</Button>
    </Dialog>,
  );
  expect(host.querySelector('[aria-label="关闭"]')).toBeNull();
  await act(async () => {
    host
      .querySelector('[role="dialog"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    host
      .querySelector(".overlay-backdrop")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  expect(close).not.toHaveBeenCalled();
  await click(host.querySelector("button"));
  expect(close).toHaveBeenCalledOnce();
});

it("lets a required workflow escape without acknowledging it", async () => {
  const acknowledge = vi.fn(),
    lock = vi.fn();
  await render(
    <Dialog
      open
      title="必须确认"
      dismissible={false}
      onClose={acknowledge}
      onEscape={lock}
    >
      <Button onClick={acknowledge}>确认</Button>
    </Dialog>,
  );
  await act(async () => {
    host
      .querySelector('[role="dialog"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
  });
  expect(lock).toHaveBeenCalledOnce();
  expect(acknowledge).not.toHaveBeenCalled();
});

it("does not read or write Web Storage when mounting or changing theme", async () => {
  const get = vi.spyOn(Storage.prototype, "getItem");
  const set = vi.spyOn(Storage.prototype, "setItem");
  try {
    for (const mode of ["light", "dark"] as const)
      await act(async () =>
        root.render(
          <TalosProvider mode={mode}>
            <Button>Test</Button>
          </TalosProvider>,
        ),
      );
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  } finally {
    get.mockRestore();
    set.mockRestore();
  }
});
