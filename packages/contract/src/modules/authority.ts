import { z } from "zod";
import { featureSchema } from "../policy/features.ts";
import { adminRoleSchema } from "../policy/roles.ts";
import { defineEntity, defineMethod } from "../protocol/definitions.ts";
import { idSchema, okSchema } from "../protocol/scalars.ts";
export const authority = Object.freeze({
  access: Object.freeze({
    set: defineMethod({
      name: "authority.access.set",
      args: z
        .object({
          user: idSchema,
          roles: z.array(adminRoleSchema).optional(),
          features: z.array(featureSchema).optional(),
        })
        .strict()
        .refine(
          (input) => input.roles !== undefined || input.features !== undefined,
        ),
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
  }),
  grant: Object.freeze({
    set: defineMethod({
      name: "authority.grant.set",
      args: z
        .object({
          resource: z.string().min(1).max(256),
          principalType: z.enum(["user", "group"]),
          principal: idSchema,
          level: z.enum(["read", "write", "own"]).nullable(),
        })
        .strict(),
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
  }),
});
export const grant = defineEntity({
  name: "grant",
  schema: z
    .object({
      id: idSchema,
      resource: z.string(),
      principalType: z.enum(["user", "group"]),
      principal: idSchema,
      level: z.enum(["read", "write", "own"]),
    })
    .strict(),
});
