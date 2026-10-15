import { z } from "zod";
import { defineMethod } from "../../protocol/definitions.ts";
import { idSchema, okSchema, revSchema } from "../../protocol/scalars.ts";
import { pageArgs } from "./paging.ts";

export const adminInvitationMethods = Object.freeze({
  list: defineMethod({
    name: "admin.invitation.list",
    args: pageArgs,
    result: z
      .object({
        items: z.array(
          z
            .object({
              id: idSchema,
              created: revSchema,
              expires: revSchema,
              claimedBy: idSchema.nullable(),
            })
            .strict(),
        ),
        total: revSchema,
      })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  revoke: defineMethod({
    name: "admin.invitation.revoke",
    args: z.object({ id: idSchema }).strict(),
    result: okSchema,
    auth: "user",
    offline: "online",
  }),
  bulkRevoke: defineMethod({
    name: "admin.invitation.bulkRevoke",
    args: z.object({ ids: z.array(idSchema).min(1).max(500) }).strict(),
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
});
