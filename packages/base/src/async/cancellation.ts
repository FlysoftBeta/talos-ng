import { AppError } from "../errors.ts";
// Structural subset shared by Chrome 70 and Node, without relying on AbortSignal.reason.
export interface CancellationSignal {
  readonly aborted: boolean;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
export function cancelled(): AppError {
  return new AppError("E_CANCELLED", "操作已取消");
}
