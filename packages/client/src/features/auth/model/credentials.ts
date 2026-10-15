/** Account handles are 1–20 ASCII letters, digits or underscores. */
export const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,20}$/;
export const sanitizeHandle = (value: string): string =>
  value.replace(/[^A-Za-z0-9_]/g, "");
/** Shown when two PINs of one account are equal. */
export const PINS_MUST_DIFFER = "两个 PIN 必须不同";
export const pinsDistinct = (pins: readonly string[]): boolean =>
  new Set(pins).size === pins.length;
