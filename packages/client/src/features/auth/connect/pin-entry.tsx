import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { PinEntryController, isPinKey } from "../model/pin-entry.ts";
import { PinEntryView } from "../view/pin-entry.tsx";
export function PinEntry({
  onComplete,
  busy = false,
  error,
  label = "PIN",
}: {
  onComplete: (pin: string) => void;
  busy?: boolean;
  error?: string;
  label?: string;
}): ReactElement {
  const [controller] = useState(() => new PinEntryController());
  controller.configure({ busy, onComplete });
  const { length } = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (isPinKey(event.key)) {
        event.preventDefault();
        controller.press(event.key);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [controller]);
  return (
    <PinEntryView
      length={length}
      busy={busy}
      error={error}
      label={label}
      onKey={controller.press}
    />
  );
}
