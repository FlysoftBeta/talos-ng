import { AppError } from "@talos/base";

export function valid(condition: boolean, message: string): asserts condition {
  if (!condition) throw new AppError("E_INVALID", message);
}

export function integer(value: number, name: string, minimum = 0): void {
  valid(Number.isSafeInteger(value) && value >= minimum, `Invalid ${name}`);
}

export function own<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}
