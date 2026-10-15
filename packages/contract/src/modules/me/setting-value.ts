import { z } from "zod";
import { idSchema, jsonSchema, stampSchema } from "../../protocol/scalars.ts";

export const MAX_SETTING_BYTES = 64 * 1024;
export const settingValueSchema = z
  .object({ v: jsonSchema, t: stampSchema, op: idSchema })
  .strict()
  .refine(
    (value) => JSON.stringify(value).length <= MAX_SETTING_BYTES / 4,
    "设置值过大",
  );
