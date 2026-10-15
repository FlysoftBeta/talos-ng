import { AppError } from "@talos/base";
import type { RuntimeSessionPort } from "../../../core/runtime-port.ts";
import { StateStore } from "../../../core/controller-state.ts";
import { PINS_MUST_DIFFER, pinsDistinct } from "../../auth/model.ts";

export type PinReplacementStep =
  "current" | "first" | "choice" | "second" | "done";
export interface PinReplacementState {
  step: PinReplacementStep;
  busy: boolean;
  error: string | undefined;
}
export type PinReplacementPort = Pick<RuntimeSessionPort, "replacePins">;

export const pinReplacementPrompt = (
  step: "current" | "first" | "second",
): string =>
  step === "current"
    ? "输入当前任意一个 PIN"
    : step === "first"
      ? "输入新的六位 PIN"
      : "输入第二个六位 PIN";

/** Current PIN → new PIN → optional second PIN; any failure returns to the first step. */
export class PinReplacementController extends StateStore<PinReplacementState> {
  private current = "";
  private first = "";
  constructor(private readonly port: PinReplacementPort) {
    super({ step: "current", busy: false, error: undefined });
  }
  enterPin = (pin: string): void => {
    const step = this.state.step;
    if (step === "current") {
      this.current = pin;
      this.patch({ step: "first" });
    } else if (step === "first") {
      this.first = pin;
      this.patch({ step: "choice" });
    } else if (step === "second") void this.replace([this.first, pin]);
  };
  addSecondPin = (): void => this.patch({ step: "second" });
  useSinglePin = (): void => void this.replace([this.first]);
  private async replace(pins: string[]): Promise<void> {
    if (!pinsDistinct(pins)) {
      this.patch({ error: PINS_MUST_DIFFER });
      return;
    }
    this.patch({ busy: true, error: undefined });
    try {
      await this.port.replacePins(this.current, pins);
      this.current = this.first = "";
      this.patch({ step: "done" });
    } catch (error) {
      this.current = this.first = "";
      this.patch({
        error:
          error instanceof AppError ? error.message : "无法更换 PIN，请重试",
        step: "current",
      });
    } finally {
      this.patch({ busy: false });
    }
  }
}
