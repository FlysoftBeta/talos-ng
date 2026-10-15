import type { RuntimeSessionPort } from "../../../core/runtime-port.ts";
import { StateStore } from "../../../core/controller-state.ts";
import {
  HANDLE_PATTERN,
  PINS_MUST_DIFFER,
  pinsDistinct,
  sanitizeHandle,
} from "./credentials.ts";

export type OnboardingStep = "first" | "choice" | "second" | "profile";
export interface OnboardingState {
  step: OnboardingStep;
  pins: readonly string[];
  handle: string;
  name: string;
  error: string | undefined;
}
export type OnboardingPort = Pick<RuntimeSessionPort, "onboard">;

export const pinStepPrompt = (step: "first" | "second"): string =>
  step === "first" ? "设置六位 PIN" : "设置第二个六位 PIN";

/** Whether the profile form may be submitted; the server connection is required. */
export function canSubmitOnboarding(
  state: Pick<OnboardingState, "handle" | "name">,
  online: boolean,
  busy: boolean,
): boolean {
  return online && !busy && !!state.handle && !!state.name.trim();
}

/** PIN setup (one or two distinct PINs), then profile fields, then account creation. */
export class OnboardingController extends StateStore<OnboardingState> {
  constructor(private readonly port: OnboardingPort) {
    super({
      step: "first",
      pins: [],
      handle: "",
      name: "",
      error: undefined,
    });
  }
  enterPin = (pin: string): void => {
    if (!pinsDistinct([...this.state.pins, pin])) {
      this.patch({ error: PINS_MUST_DIFFER });
      return;
    }
    this.patch({
      error: undefined,
      pins: [...this.state.pins, pin],
      step: this.state.step === "first" ? "choice" : "profile",
    });
  };
  addSecondPin = (): void => this.patch({ step: "second" });
  useSinglePin = (): void => this.patch({ step: "profile" });
  restart = (): void => this.patch({ pins: [], step: "first" });
  setHandle = (value: string): void =>
    this.patch({ handle: sanitizeHandle(value) });
  setName = (value: string): void => this.patch({ name: value });
  submit = (online: boolean): void => {
    const { handle, name, pins } = this.state;
    if (online && HANDLE_PATTERN.test(handle) && name.trim())
      void this.port.onboard({ pins: [...pins], handle, name: name.trim() });
  };
}
