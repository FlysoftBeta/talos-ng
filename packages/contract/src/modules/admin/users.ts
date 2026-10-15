import { z } from "zod";
import { defineMethod } from "../../protocol/definitions.ts";
import { idSchema, revSchema } from "../../protocol/scalars.ts";
import { adminRoleSchema } from "../../policy/roles.ts";
import { featureSchema } from "../../policy/features.ts";
import { handleSchema, displayNameSchema, pinSchema } from "../identity.ts";
import { pageArgs } from "./paging.ts";

export const adminUserSchema = z
  .object({
    id: idSchema,
    handle: handleSchema,
    name: displayNameSchema,
    roles: z.array(adminRoleSchema),
    features: z.array(featureSchema),
    mutedUntil: revSchema,
    banned: z.boolean(),
    bannedUntil: revSchema.nullable(),
    deactivated: z.boolean(),
    created: revSchema,
  })
  .strict();
export type AdminUser = z.infer<typeof adminUserSchema>;
const userChanges = z
  .object({
    handle: handleSchema.optional(),
    name: displayNameSchema.optional(),
    pin: pinSchema.optional(),
    roles: z.array(adminRoleSchema).optional(),
    features: z.array(featureSchema).optional(),
    mutedUntil: revSchema.optional(),
    banned: z.boolean().optional(),
    bannedUntil: revSchema.nullable().optional(),
    deactivated: z.boolean().optional(),
  })
  .strict();
export const adminUserMethods = Object.freeze({
  list: defineMethod({
    name: "admin.user.list",
    args: pageArgs.extend({
      query: z.string().max(100).optional(),
      sort: z.enum(["handle", "created", "name"]).optional(),
    }),
    result: z
      .object({ items: z.array(adminUserSchema), total: revSchema })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  create: defineMethod({
    name: "admin.user.create",
    args: z
      .object({
        handle: handleSchema,
        name: displayNameSchema.optional(),
        pin: pinSchema,
        features: z.array(featureSchema).optional(),
      })
      .strict(),
    result: z.object({ user: adminUserSchema }).strict(),
    auth: "user",
    offline: "online",
  }),
  update: defineMethod({
    name: "admin.user.update",
    args: userChanges
      .extend({ id: idSchema })
      .refine(
        (value) => Object.keys(value).some((key) => key !== "id"),
        "至少指定一项变更",
      ),
    result: z.object({ user: adminUserSchema }).strict(),
    auth: "user",
    offline: "online",
  }),
  bulk: defineMethod({
    name: "admin.user.bulk",
    args: z
      .object({
        ids: z.array(idSchema).min(1).max(500),
        changes: userChanges
          .omit({ handle: true, name: true, pin: true })
          .optional(),
        gateChanges: z
          .record(featureSchema, z.enum(["unchanged", "enable", "disable"]))
          .optional(),
        roleChanges: z
          .record(adminRoleSchema, z.enum(["unchanged", "enable", "disable"]))
          .optional(),
      })
      .strict()
      .refine(
        (value) =>
          !!value.changes || !!value.gateChanges || !!value.roleChanges,
        "至少指定一项变更",
      ),
    result: z
      .object({
        results: z.array(
          z
            .object({
              id: idSchema,
              ok: z.boolean(),
              error: z.string().optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  purge: defineMethod({
    name: "admin.user.purge",
    args: z.object({ id: idSchema }).strict(),
    result: z.object({ jobId: idSchema }).strict(),
    auth: "user",
    offline: "online",
  }),
});
