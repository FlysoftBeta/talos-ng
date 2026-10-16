import { isUlid } from "@talos/base";
import { z } from "zod";
export const idSchema = z.string().refine(isUlid, "无效的 ULID");
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const revSchema = z.number().int().nonnegative().safe();
export const emptySchema = z.object({}).strict();
export const okSchema = z.object({ ok: z.literal(true) }).strict();
export const stampSchema = z
  .object({ ms: revSchema, counter: revSchema })
  .strict();
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
/**
 * Plain JSON data (finite numbers, plain objects). Checked by one recursive
 * walk: a lazy zod union rebuilt its six member schemas for every node and
 * collected an issue per rejected alternative, which dominated sync costs.
 */
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (depth > 256) return false;
      if (Array.isArray(value)) {
        for (const item of value)
          if (!isJsonValue(item, depth + 1)) return false;
        return true;
      }
      const prototype = Object.getPrototypeOf(value) as unknown;
      if (prototype !== Object.prototype && prototype !== null) return false;
      for (const key in value)
        if (
          Object.prototype.hasOwnProperty.call(value, key) &&
          !isJsonValue((value as Record<string, unknown>)[key], depth + 1)
        )
          return false;
      return true;
    }
    default:
      return false;
  }
}
export const jsonSchema: z.ZodType<JsonValue> = z.custom<JsonValue>(
  (value) => isJsonValue(value),
  { message: "无效的 JSON 数据" },
);
