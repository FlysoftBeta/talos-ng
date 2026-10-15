import { StateStore } from "../../../core/controller-state.ts";

export const PIN_LENGTH = 6;

/** Keys the physical keyboard may contribute to a PIN. */
export function isPinKey(key: string): boolean {
  return /^\d$/.test(key) || key === "Backspace" || key === "Delete";
}

/** The pending digits after one key press; a full PIN is handled by the controller. */
export function nextPin(current: string, key: string): string {
  return key === "清除" || key === "Delete"
    ? ""
    : key === "退格" || key === "Backspace"
      ? current.slice(0, -1)
      : /^\d$/.test(key)
        ? (current + key).slice(0, PIN_LENGTH)
        : current;
}

export interface PinEntryOptions {
  busy: boolean;
  onComplete: (pin: string) => void;
}

/** Collects six digits; the digits never enter observable state and are cleared before completion fires. */
export class PinEntryController extends StateStore<{ length: number }> {
  private value = "";
  private options: PinEntryOptions = { busy: false, onComplete: () => {} };
  constructor() {
    super({ length: 0 });
  }
  configure(options: PinEntryOptions): void {
    this.options = options;
  }
  press = (key: string): void => {
    if (this.options.busy) return;
    const next = nextPin(this.value, key);
    this.value = next;
    this.patch({ length: next.length });
    if (next.length === PIN_LENGTH) {
      this.value = "";
      this.patch({ length: 0 });
      this.options.onComplete(next);
    }
  };
}
