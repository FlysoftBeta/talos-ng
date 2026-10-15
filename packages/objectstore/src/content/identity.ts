import { AppError } from "@talos/base";

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
export function validateId(id: string): void {
  if (!isObjectId(id)) throw new AppError("E_INVALID", "Invalid object id");
}
export function validateStageId(id: string): void {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id))
    throw new AppError("E_INVALID", "Invalid stage id");
}
