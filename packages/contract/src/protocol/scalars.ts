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
export const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ]),
);
