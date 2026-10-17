import { z } from "zod";
import { defineMethod, defineEntity } from "../protocol/definitions.ts";
import {
  idSchema,
  revSchema,
  stampSchema,
  emptySchema,
  okSchema,
} from "../protocol/scalars.ts";
const money = z.number().int().nonnegative().max(1_000_000_000_000);
export const aiDraftSchema = z.object({
  id: z.string().min(1),
  textId: idSchema.optional(),
  value: z.object({ v: z.string().max(16000), t: stampSchema, op: idSchema }),
});
export const aiConversationSchema = z.object({
  id: idSchema,
  title: z.string(),
  tags: z.array(z.string()),
  lastSeq: revSchema,
  readSeq: revSchema,
  running: idSchema.nullable(),
  updated: revSchema,
});
export const aiImageSchema = z.object({
  path: z.string(),
  mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  size: revSchema,
});
export const aiMessageSchema = z.object({
  id: idSchema,
  conversation: idSchema,
  seq: revSchema,
  rev: revSchema,
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  textLength: revSchema.optional(),
  images: z.array(aiImageSchema),
  status: z.enum(["queued", "running", "done", "failed", "cancelled"]),
  created: revSchema,
  error: z.string().nullable(),
});
export const aiCreditSchema = z.object({
  id: z.literal("account"),
  configured: z.boolean(),
  topup: money,
  reserved: money,
  daily: money,
  weekly: money,
  dayUsed: money,
  weekUsed: money,
  available: money,
  planEnds: revSchema,
  required: money,
});
export const aiPolicySchema = z.object({
  daily: money,
  weekly: money,
  days: z.number().int().min(1).max(3650),
});
export const aiFileSchema = z.object({
  path: z.string(),
  mime: z.string(),
  size: revSchema,
  rev: revSchema,
});
export const aiStatsSchema = z.object({
  policy: aiPolicySchema,
  topup: money,
  planStock: money,
  consumed: money,
  days: z.array(z.object({ day: z.string(), amount: money })),
  ledger: z.array(
    z.object({
      id: z.string(),
      user: z.string(),
      kind: z.string(),
      amount: z.number(),
      note: z.string(),
      created: revSchema,
    }),
  ),
});
const method = <N extends string, A extends z.ZodType, R extends z.ZodType>(
  name: N,
  args: A,
  result: R,
  offline: "queue" | "online" = "online",
) => defineMethod({ name, args, result, auth: "user", offline });
export const ai = {
  text: {
    put: method(
      "ai.text.put",
      z.object({
        id: idSchema,
        offset: revSchema,
        total: z
          .number()
          .int()
          .min(1)
          .max(10 * 1024 * 1024),
        text: z.string().max(16000),
      }),
      okSchema,
      "queue",
    ),
  },
  content: {
    fetch: defineMethod({
      name: "ai.content.fetch",
      args: z.object({
        kind: z.enum(["message", "draft", "file"]),
        id: z.string(),
        offset: revSchema,
      }),
      result: z.object({ size: revSchema, eof: z.boolean() }),
      auth: "user",
      offline: "online",
      body: "out",
    }),
  },
  conversation: {
    create: method(
      "ai.conversation.create",
      z.object({ title: z.string().trim().min(1).max(120) }),
      aiConversationSchema,
    ),
    update: method(
      "ai.conversation.update",
      z.object({
        id: idSchema,
        title: z.string().trim().min(1).max(120),
        tags: z.array(z.string().trim().min(1).max(40)).max(12),
      }),
      okSchema,
    ),
    fork: method(
      "ai.conversation.fork",
      z.object({ message: idSchema }),
      aiConversationSchema,
    ),
    read: method(
      "ai.conversation.read",
      z.object({ id: idSchema, seq: revSchema }),
      okSchema,
      "queue",
    ),
  },
  message: {
    page: method(
      "ai.message.page",
      z.object({
        conversation: idSchema,
        before: revSchema.optional(),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      // `rev`: the server revision the page was read at.
      z.object({
        messages: z.array(aiMessageSchema),
        more: z.boolean(),
        rev: revSchema,
      }),
    ),
  },
  draft: { set: method("ai.draft.set", aiDraftSchema, okSchema, "queue") },
  run: {
    start: method(
      "ai.run.start",
      z.object({
        conversation: idSchema,
        text: z.string().trim().min(1).max(16000),
        textId: idSchema.optional(),
        images: z.array(z.string()).max(4).default([]),
      }),
      z.object({ id: idSchema }),
    ),
    stop: method("ai.run.stop", z.object({ id: idSchema }), okSchema),
  },
  account: { get: method("ai.account.get", emptySchema, aiCreditSchema) },
  workspace: {
    list: method("ai.workspace.list", emptySchema, z.array(aiFileSchema)),
    read: method(
      "ai.workspace.read",
      z.object({ path: z.string() }),
      z.object({ file: aiFileSchema, content: z.string() }),
    ),
    write: method(
      "ai.workspace.write",
      z.object({
        path: z.string().max(240),
        content: z.string().max(16000),
        textId: idSchema.optional(),
        expected: revSchema.nullable(),
      }),
      aiFileSchema,
    ),
    delete: method(
      "ai.workspace.delete",
      z.object({ path: z.string(), expected: revSchema }),
      okSchema,
    ),
    image: method(
      "ai.workspace.image",
      z.object({ upload: idSchema, mime: aiImageSchema.shape.mime }),
      aiFileSchema,
    ),
  },
  admin: {
    users: method(
      "ai.admin.users",
      z.object({ query: z.string().max(100) }),
      z.array(z.object({ id: idSchema, name: z.string(), handle: z.string() })),
    ),
    stats: method("ai.admin.stats", emptySchema, aiStatsSchema),
    account: method(
      "ai.admin.account",
      z.object({ user: idSchema }),
      aiCreditSchema,
    ),
    assign: method(
      "ai.admin.assign",
      z.object({
        user: idSchema,
        key: idSchema,
        amount: money,
        days: z.number().int().min(0).max(3650),
        note: z.string().max(200),
      }),
      aiCreditSchema,
    ),
    policy: method("ai.admin.policy", aiPolicySchema, okSchema),
  },
};
export const aiMethods = [
  ...Object.values(ai.text),
  ...Object.values(ai.content),
  ...Object.values(ai.conversation),
  ...Object.values(ai.message),
  ...Object.values(ai.draft),
  ...Object.values(ai.run),
  ...Object.values(ai.account),
  ...Object.values(ai.workspace),
  ...Object.values(ai.admin),
];
export const aiConversation = defineEntity({
  name: "aiConversation",
  schema: aiConversationSchema,
});
export const aiMessage = defineEntity({
  name: "aiMessage",
  schema: aiMessageSchema,
  windowed: true,
});
export const aiDraft = defineEntity({ name: "aiDraft", schema: aiDraftSchema });
export const aiCredit = defineEntity({
  name: "aiCredit",
  schema: aiCreditSchema,
});
export type AiConversation = z.infer<typeof aiConversationSchema>;
export type AiMessage = z.infer<typeof aiMessageSchema>;
export type AiDraft = z.infer<typeof aiDraftSchema>;
export type AiCredit = z.infer<typeof aiCreditSchema>;
export type AiPolicy = z.infer<typeof aiPolicySchema>;
export type AiFile = z.infer<typeof aiFileSchema>;
export type AiStats = z.infer<typeof aiStatsSchema>;
