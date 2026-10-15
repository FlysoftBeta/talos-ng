import { z } from "zod";
import { defineEntity, defineMethod } from "../protocol/definitions.ts";
import {
  emptySchema,
  idSchema,
  okSchema,
  revSchema,
} from "../protocol/scalars.ts";

export const communityConversationSchema = z
  .object({
    id: idSchema,
    kind: z.enum(["group", "dm"]),
    type: z.enum(["normal", "wild", "announcement"]),
    name: z.string(),
    handle: z.string(),
    parent: idSchema.nullable(),
    owner: idSchema.nullable(),
    discoverable: z.boolean(),
    membersHidden: z.boolean(),
    adminOnly: z.boolean(),
    noLeave: z.boolean(),
    passwordRequired: z.boolean(),
    created: revSchema,
    rev: revSchema,
  })
  .strict();
export type CommunityConversation = z.infer<typeof communityConversationSchema>;
export const communityMemberSchema = z
  .object({
    user: idSchema,
    conversation: idSchema,
    name: z.string(),
    handle: z.string(),
    hidden: z.boolean(),
    joined: revSchema,
    rev: revSchema,
  })
  .strict();
export type CommunityMember = z.infer<typeof communityMemberSchema>;
export const createGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    handle: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,32}$/)
      .optional(),
    password: z.string().min(1).max(128).optional(),
    parent: idSchema.nullable().optional(),
    discoverable: z.boolean().optional(),
    membersHidden: z.boolean().optional(),
    adminOnly: z.boolean().optional(),
    noLeave: z.boolean().optional(),
  })
  .strict();
export type CreateGroup = z.infer<typeof createGroupSchema>;
export const joinSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("search") }).strict(),
  z.object({ type: z.literal("group"), group: idSchema }).strict(),
]);
export type JoinSource = z.infer<typeof joinSourceSchema>;
const groupArgs = z.object({ group: idSchema }).strict();
export const community = Object.freeze({
  group: Object.freeze({
    list: defineMethod({
      name: "community.group.list",
      args: emptySchema,
      result: z.array(communityConversationSchema),
      auth: "user",
      offline: "online",
    }),
    create: defineMethod({
      name: "community.group.create",
      args: createGroupSchema,
      result: communityConversationSchema,
      auth: "user",
      offline: "online",
    }),
    find: defineMethod({
      name: "community.group.find",
      args: z.object({ query: z.string().trim().max(100) }).strict(),
      result: z.array(communityConversationSchema),
      auth: "user",
      offline: "online",
    }),
    children: defineMethod({
      name: "community.group.children",
      args: groupArgs,
      result: z.array(communityConversationSchema),
      auth: "user",
      offline: "online",
    }),
    join: defineMethod({
      name: "community.group.join",
      args: z
        .object({
          group: idSchema,
          source: joinSourceSchema,
          password: z.string().max(128).optional(),
        })
        .strict(),
      result: communityConversationSchema,
      auth: "user",
      offline: "online",
    }),
    leave: defineMethod({
      name: "community.group.leave",
      args: groupArgs,
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
    members: defineMethod({
      name: "community.group.members",
      args: groupArgs,
      result: z
        .object({
          members: z.array(communityMemberSchema),
          self: communityMemberSchema,
          hidden: z.boolean(),
        })
        .strict(),
      auth: "user",
      offline: "online",
    }),
    hide: defineMethod({
      name: "community.group.hide",
      args: z.object({ group: idSchema, hidden: z.boolean() }).strict(),
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
  }),
  dm: Object.freeze({
    open: defineMethod({
      name: "community.dm.open",
      args: z.object({ user: idSchema, group: idSchema }).strict(),
      result: communityConversationSchema,
      auth: "user",
      offline: "online",
    }),
  }),
});
export const communityConversation = defineEntity({
  name: "communityConversation",
  schema: communityConversationSchema,
});
export const communityMember = defineEntity({
  name: "communityMember",
  schema: communityMemberSchema,
});
export const communitySelf = defineEntity({
  name: "communitySelf",
  schema: communityMemberSchema,
});
