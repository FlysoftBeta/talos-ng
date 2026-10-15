import { z } from "zod";
import { defineMethod } from "../../protocol/definitions.ts";
import { idSchema, okSchema, revSchema } from "../../protocol/scalars.ts";
import { communityMemberSchema, createGroupSchema } from "../community.ts";
import { pageArgs } from "./paging.ts";

export const adminGroupSchema = z
  .object({
    id: idSchema,
    handle: z.string(),
    name: z.string(),
    type: z.string(),
    memberCount: z.number().int().nonnegative(),
    parent: idSchema.nullable(),
    owner: idSchema.nullable(),
    discoverable: z.boolean(),
    membersHidden: z.boolean(),
    adminOnly: z.boolean(),
    noLeave: z.boolean(),
    passwordRequired: z.boolean(),
  })
  .strict();
export type AdminGroup = z.infer<typeof adminGroupSchema>;
export const adminGroupMethods = Object.freeze({
  list: defineMethod({
    name: "admin.group.list",
    args: pageArgs.extend({ query: z.string().max(100).optional() }),
    result: z
      .object({ items: z.array(adminGroupSchema), total: revSchema })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  create: defineMethod({
    name: "admin.group.create",
    args: createGroupSchema,
    result: z.object({ group: adminGroupSchema }).strict(),
    auth: "user",
    offline: "online",
  }),
  update: defineMethod({
    name: "admin.group.update",
    args: createGroupSchema.partial().extend({
      id: idSchema,
      type: z.enum(["normal", "wild", "announcement"]).optional(),
      password: z.string().max(128).optional(),
    }),
    result: z.object({ group: adminGroupSchema }).strict(),
    auth: "user",
    offline: "online",
  }),
  delete: defineMethod({
    name: "admin.group.delete",
    args: z.object({ id: idSchema, name: z.string() }).strict(),
    result: okSchema,
    auth: "user",
    offline: "online",
  }),
  members: defineMethod({
    name: "admin.group.members",
    args: z.object({ id: idSchema }).strict(),
    result: z.array(communityMemberSchema),
    auth: "user",
    offline: "online",
  }),
  member: defineMethod({
    name: "admin.group.member",
    args: z
      .object({
        id: idSchema,
        user: idSchema,
        operation: z.enum(["add", "kick", "owner"]),
      })
      .strict(),
    result: okSchema,
    auth: "user",
    offline: "online",
  }),
});
