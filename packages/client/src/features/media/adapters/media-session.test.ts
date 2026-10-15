import { expect, it, vi } from "vitest";
import { setMediaAction } from "./media-session.ts";

it("tolerates unsupported OS actions during registration and cleanup", () => {
  const setActionHandler = vi.fn((action: MediaSessionAction) => {
    if (action === "seekto") throw new TypeError("Unsupported action");
  });
  const session = { setActionHandler };
  const handler = () => {};
  expect(() => setMediaAction(session, "seekto", handler)).not.toThrow();
  expect(() => setMediaAction(session, "seekto", null)).not.toThrow();
  setMediaAction(session, "play", handler);
  expect(setActionHandler).toHaveBeenLastCalledWith("play", handler);
});
