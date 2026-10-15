import { AppError } from "@talos/base";

/** Always reject forbidden persisted values, including in cycles and collections. */
export function guardValue(value: unknown): void {
  const seen = new Set<object>();
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === "function" || typeof item === "symbol")
      throw new AppError("E_INVALID", "Functions and symbols cannot be stored");
    if (!item || typeof item !== "object" || seen.has(item)) continue;
    seen.add(item);
    const v = item as Record<string, unknown>;
    const tag = Object.prototype.toString.call(item);
    if (
      tag === "[object Blob]" ||
      tag === "[object File]" ||
      (typeof v.size === "number" &&
        typeof v.type === "string" &&
        typeof v.slice === "function") ||
      (typeof v.nodeType === "number" && typeof v.nodeName === "string")
    ) {
      throw new AppError(
        "E_INVALID",
        "Blob, File and DOM nodes must never be persisted",
      );
    }
    if (
      item instanceof ArrayBuffer ||
      ArrayBuffer.isView(item) ||
      item instanceof Date
    )
      continue;
    if (item instanceof Map || tag === "[object Map]") {
      Map.prototype.forEach.call(item, (val: unknown, key: unknown) =>
        pending.push(key, val),
      );
    } else if (item instanceof Set || tag === "[object Set]") {
      Set.prototype.forEach.call(item, (val: unknown) => pending.push(val));
    } else
      for (const key of Object.keys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (descriptor?.get || descriptor?.set)
          throw new AppError(
            "E_INVALID",
            "Persist plain values, not accessor properties",
          );
        pending.push(descriptor?.value);
      }
  }
}
