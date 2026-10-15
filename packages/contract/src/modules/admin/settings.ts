import { z } from "zod";
import { defineMethod } from "../../protocol/definitions.ts";
import { emptySchema } from "../../protocol/scalars.ts";

export const adminSettingsSchema = z
  .object({
    whitelist: z.boolean(),
    systemLock: z.boolean(),
    idleLock: z.boolean(),
    identitySignals: z.array(z.enum(["clientId", "userAgent", "ip"])).min(1),
    maxVolume: z.number().min(0).max(1),
    evictionDays: z.number().int().min(1).max(3650),
  })
  .strict();
export type AdminSettings = z.infer<typeof adminSettingsSchema>;
export const adminSettingsMethods = Object.freeze({
  get: defineMethod({
    name: "admin.settings.get",
    args: emptySchema,
    result: adminSettingsSchema,
    auth: "user",
    offline: "online",
  }),
  set: defineMethod({
    name: "admin.settings.set",
    args: z
      .object({
        maxVolume: z.number().min(0).max(1).optional(),
        evictionDays: z.number().int().min(1).max(3650).optional(),
      })
      .strict(),
    result: adminSettingsSchema,
    auth: "user",
    offline: "online",
  }),
});
