import { z } from "zod";
import { defineEntity, defineMethod } from "../../protocol/definitions.ts";
import { userSchema } from "../auth.ts";
import { settingValueSchema } from "./setting-value.ts";
export const settingSchema = z
  .object({
    id: z.string(),
    key: z.string().min(1).max(128),
    value: settingValueSchema,
  })
  .strict();
export const profile = defineEntity({ name: "profile", schema: userSchema });
export const setting = defineEntity({ name: "setting", schema: settingSchema });
export const me = Object.freeze({
  profile,
  setting: Object.freeze({
    ...setting,
    set: defineMethod({
      name: "me.setting.set",
      args: z
        .object({
          key: z
            .string()
            .min(1)
            .max(128)
            .regex(/^[a-zA-Z0-9._-]+$/),
          value: settingValueSchema,
        })
        .strict(),
      result: z.object({ setting: settingSchema }).strict(),
      auth: "user",
      offline: "queue",
    }),
  }),
});
