import type { StatusViewModel, TransferUpdate } from "./model.ts";
/** Replaces (or, for `undefined`, removes) one transfer while keeping the others in place. */
export function projectTransfer(
  current: StatusViewModel["transfers"],
  id: string,
  value: TransferUpdate | undefined,
): StatusViewModel["transfers"] {
  if (!value) return current.filter((item) => item.id !== id);
  const next = { id, direction: "download" as const, ...value };
  return current.some((item) => item.id === id)
    ? current.map((item) => (item.id === id ? next : item))
    : [...current, next];
}
