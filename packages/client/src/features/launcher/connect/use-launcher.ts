import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  createCanvasSurface,
  createMediaActions,
  launcherSupported,
} from "../adapters/browser.ts";
import { LauncherController } from "../model/launcher.ts";
import type { LauncherItem } from "../model/selection.ts";
import { drawLauncher } from "../view/draw.ts";

/**
 * The floating launcher. `supported` is false where Picture-in-Picture or canvas
 * capture is missing; `toggle` must be called from a click handler.
 */
export function useLauncher(
  items: readonly LauncherItem[],
  open: (item: LauncherItem) => void,
  restoreMediaControls: () => (() => void) | void,
): {
  supported: boolean;
  active: boolean;
  toggle(onError: (message: string) => void): void;
} {
  const [supported] = useState(launcherSupported);
  const latest = useRef({ open, restoreMediaControls });
  latest.current = { open, restoreMediaControls };
  const [controller] = useState(() => {
    if (!supported) return undefined;
    const surface = createCanvasSurface(drawLauncher),
      actions = createMediaActions(() => latest.current.restoreMediaControls());
    return {
      surface,
      launcher: new LauncherController(surface, actions, (item) => {
        window.focus();
        latest.current.open(item);
      }),
    };
  });
  useEffect(() => {
    controller?.surface.prepare();
    return () => {
      controller?.launcher.stop();
      controller?.surface.dispose();
    };
  }, [controller]);
  useEffect(() => controller?.launcher.setItems(items));
  const active = useSyncExternalStore(
    controller?.launcher.subscribe ?? noSubscribe,
    () => controller?.launcher.isActive() ?? false,
  );
  return {
    supported,
    active,
    toggle(onError) {
      if (!controller) return;
      if (active) return controller.launcher.stop();
      controller.launcher.start().catch(() => onError("无法打开悬浮窗口"));
    },
  };
}
const noSubscribe = (): (() => void) => () => undefined;
