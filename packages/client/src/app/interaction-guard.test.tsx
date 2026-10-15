import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { AppInteractionGuard } from "./interaction-guard.tsx";

it("cancels pinch gestures only while mounted", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<AppInteractionGuard />));
  const active = new Event("gesturestart", { cancelable: true });
  document.dispatchEvent(active);
  expect(active.defaultPrevented).toBe(true);
  await act(async () => root.unmount());
  const after = new Event("gesturestart", { cancelable: true });
  document.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
  container.remove();
});
