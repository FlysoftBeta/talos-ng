import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import {
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import {
  OnboardingController,
  canSubmitOnboarding,
  pinStepPrompt,
} from "../model/onboarding.ts";
import { OnboardingView } from "../view/onboarding.tsx";
import { PinEntry } from "./pin-entry.tsx";
export function OnboardingScreen(): ReactElement {
  const runtime = useRuntime();
  const snapshot = useClientSnapshot();
  const [controller] = useState(() => new OnboardingController(runtime));
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const online = snapshot.status.connection !== "offline";
  const pinStep = state.step === "first" || state.step === "second";
  return (
    <OnboardingView
      step={pinStep ? "pin" : state.step === "choice" ? "choice" : "profile"}
      prompt={pinStep ? pinStepPrompt(state.step as "first" | "second") : ""}
      pinEntry={
        pinStep && (
          <PinEntry
            key={state.step}
            error={state.error}
            onComplete={controller.enterPin}
          />
        )
      }
      device={snapshot.device}
      onAddSecond={controller.addSecondPin}
      onSingle={controller.useSinglePin}
      profile={{
        handle: state.handle,
        name: state.name,
        busy: snapshot.busy,
        error: snapshot.error,
        offline: !online,
        canSubmit: canSubmitOnboarding(state, online, snapshot.busy),
        onHandle: controller.setHandle,
        onName: controller.setName,
        onSubmit: () => controller.submit(online),
        onRestart: controller.restart,
      }}
    />
  );
}
