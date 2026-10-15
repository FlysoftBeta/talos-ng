import { z } from "zod";
import { defineMethod } from "../../protocol/definitions.ts";
import {
  emptySchema,
  idSchema,
  okSchema,
  revSchema,
} from "../../protocol/scalars.ts";
import { pageArgs } from "./paging.ts";
import { adminSettingsSchema } from "./settings.ts";

export const adminDeviceSchema = z
  .object({
    id: idSchema,
    label: z.string(),
    lastSeen: revSchema,
    whitelisted: z.boolean(),
    locked: z.boolean(),
    boundUser: idSchema.nullable(),
    persistent: z.boolean(),
  })
  .strict();
export type AdminDevice = z.infer<typeof adminDeviceSchema>;
export const adminDeviceMethods = Object.freeze({
  list: defineMethod({
    name: "admin.device.list",
    args: pageArgs.extend({ query: z.string().max(100).optional() }),
    result: z
      .object({ items: z.array(adminDeviceSchema), total: revSchema })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  update: defineMethod({
    name: "admin.device.update",
    args: z
      .object({
        id: idSchema,
        label: z.string().max(1000).optional(),
        boundUser: idSchema.nullable().optional(),
        whitelisted: z.boolean().optional(),
        locked: z.boolean().optional(),
        persistent: z.boolean().optional(),
      })
      .strict(),
    result: z.object({ device: adminDeviceSchema }).strict(),
    auth: "user",
    offline: "online",
  }),
  delete: defineMethod({
    name: "admin.device.delete",
    args: z.object({ id: idSchema }).strict(),
    result: okSchema,
    auth: "user",
    offline: "online",
  }),
  policy: Object.freeze({
    get: defineMethod({
      name: "admin.device.policy.get",
      args: emptySchema,
      result: adminSettingsSchema,
      auth: "user",
      offline: "online",
    }),
    set: defineMethod({
      name: "admin.device.policy.set",
      args: z
        .object({
          whitelist: z.boolean().optional(),
          systemLock: z.boolean().optional(),
          idleLock: z.boolean().optional(),
          identitySignals: z
            .array(z.enum(["clientId", "userAgent", "ip"]))
            .min(1)
            .optional(),
        })
        .strict(),
      result: adminSettingsSchema,
      auth: "user",
      offline: "online",
    }),
  }),
});
