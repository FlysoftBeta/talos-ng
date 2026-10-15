import { useEffect } from "react";
import type { ReactElement } from "react";

/** Suppress Safari/WebView pinch gestures without blocking ordinary scrolling. */
export function AppInteractionGuard(): ReactElement | null {
  useEffect(() => {
    const prevent = (event: Event): void => event.preventDefault();
    document.addEventListener("gesturestart", prevent, { passive: false });
    document.addEventListener("gesturechange", prevent, { passive: false });
    document.addEventListener("gestureend", prevent, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("gesturechange", prevent);
      document.removeEventListener("gestureend", prevent);
    };
  }, []);
  return null;
}
