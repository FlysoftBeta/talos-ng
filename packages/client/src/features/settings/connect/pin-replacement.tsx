import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { PinEntry } from "../../auth/index.ts";
import {
  PinReplacementController,
  pinReplacementPrompt,
} from "../model/pin-replacement.ts";
import { PinReplacementView } from "../view/pin-replacement.tsx";
export function PinReplacement({
  onClose,
}: {
  onClose: () => void;
}): ReactElement {
  const runtime = useRuntime();
  const [controller] = useState(() => new PinReplacementController(runtime));
  const { step, busy, error } = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const entering = step === "current" || step === "first" || step === "second";
  return (
    <PinReplacementView
      step={entering ? "pin" : step}
      prompt={entering ? pinReplacementPrompt(step) : ""}
      busy={busy}
      pinEntry={
        entering && (
          <PinEntry
            key={step}
            busy={busy}
            error={error}
            onComplete={controller.enterPin}
          />
        )
      }
      onClose={onClose}
      onAddSecond={controller.addSecondPin}
      onSingle={controller.useSinglePin}
    />
  );
}
