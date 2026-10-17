import { z } from "zod";
import { defineEntity, defineMethod } from "../protocol/definitions.ts";
import {
  hashSchema,
  idSchema,
  okSchema,
  revSchema,
  stampSchema,
} from "../protocol/scalars.ts";

export const CHAT_MAX_TEXT = 5_000_000;
export const CHAT_TEXT_CHUNK = 16_000;
export const CHAT_PREVIEW = 1000;
export const CHAT_IMAGE_LIMIT = 12 * 1024 * 1024;
export const chatFileSchema = z
  .object({
    rid: hashSchema,
    size: revSchema,
    mime: z.string(),
    width: revSchema,
    height: revSchema,
  })
  .strict();
export const chatImageSchema = z
  .object({ original: chatFileSchema, thumbnail: chatFileSchema })
  .strict();
export const stickerSchema = z
  .object({
    id: z.string(),
    pack: z.string(),
    name: z.string(),
    file: chatFileSchema,
  })
  .strict();
export const postSchema = z
  .object({
    id: idSchema,
    conversation: idSchema,
    seq: revSchema,
    rev: revSchema,
    author: idSchema,
    authorName: z.string(),
    kind: z.enum(["text", "sticker", "image"]),
    preview: z.string().max(CHAT_PREVIEW),
    bodyLength: revSchema,
    replyTo: idSchema.nullable(),
    created: revSchema,
    edited: revSchema.nullable(),
    deletedAt: revSchema.nullable(),
    sticker: stickerSchema.nullable(),
    image: chatImageSchema.nullable(),
  })
  .strict();
const boolLww = z
  .object({ v: z.boolean(), t: stampSchema, op: idSchema })
  .strict();
const draftLww = z
  .object({ v: z.string().max(CHAT_TEXT_CHUNK), t: stampSchema, op: idSchema })
  .strict();
export const retentionSchema = z.enum(["auto", "week", "half-year"]);
const retentionLww = z
  .object({ v: retentionSchema, t: stampSchema, op: idSchema })
  .strict();
export const chatStateSchema = z
  .object({
    id: idSchema,
    conversation: idSchema,
    readSeq: revSchema,
    pin: boolLww,
    mute: boolLww,
    draft: draftLww,
    draftTextId: idSchema.nullable(),
    retention: retentionLww,
    lastSeq: revSchema,
    lastPost: postSchema.nullable(),
    updated: revSchema,
    mutedUntil: revSchema,
  })
  .strict();
export const announcementSchema = z
  .object({
    id: z.literal("current"),
    revision: revSchema,
    title: z.string().min(1).max(120),
    text: z.string().min(1).max(16000),
    published: revSchema,
  })
  .strict();
export const announcementAckSchema = z
  .object({ id: z.literal("current"), revision: revSchema })
  .strict();
export type ChatPost = z.infer<typeof postSchema>;
export type ChatState = z.infer<typeof chatStateSchema>;
export type ChatImage = z.infer<typeof chatImageSchema>;
export type ChatFile = z.infer<typeof chatFileSchema>;
export type ChatSticker = z.infer<typeof stickerSchema>;
export type ChatAnnouncement = z.infer<typeof announcementSchema>;
const textInput = {
  text: z.string().max(CHAT_TEXT_CHUNK).optional(),
  textId: idSchema.optional(),
};
const textSource = (v: { text?: string; textId?: string }): boolean =>
  (v.text !== undefined) !== (v.textId !== undefined);
const postResult = z.object({ post: postSchema }).strict();
const chunkArgs = {
  offset: revSchema,
  limit: z
    .number()
    .int()
    .min(1)
    .max(512 * 1024)
    .optional(),
};
const chunkResult = z
  .object({ size: revSchema, offset: revSchema, eof: z.boolean() })
  .strict();
export const chat = Object.freeze({
  post: Object.freeze({
    ...defineEntity({ name: "post", schema: postSchema, windowed: true }),
    send: defineMethod({
      name: "chat.post.send",
      args: z
        .object({
          id: idSchema,
          conversation: idSchema,
          kind: z.enum(["text", "sticker"]),
          ...textInput,
          sticker: z.string().max(256).optional(),
          replyTo: idSchema.optional(),
        })
        .strict()
        .refine((v) =>
          v.kind === "text"
            ? textSource(v) && !v.sticker
            : !!v.sticker && v.text === undefined && !v.textId,
        ),
      result: postResult,
      auth: "user",
      offline: "queue",
    }),
    page: defineMethod({
      name: "chat.post.page",
      args: z
        .object({
          conversation: idSchema,
          anchor: revSchema.optional(),
          direction: z.enum(["before", "after", "around", "latest"]).optional(),
          limit: z.number().int().min(1).max(40).optional(),
        })
        .strict(),
      result: z
        .object({
          posts: z.array(postSchema),
          first: revSchema,
          last: revSchema,
          latest: revSchema,
          hasBefore: z.boolean(),
          hasAfter: z.boolean(),
          /** Server revision the page was read at: it certifies first..last then. */
          rev: revSchema,
        })
        .strict(),
      auth: "user",
      offline: "online",
    }),
    edit: defineMethod({
      name: "chat.post.edit",
      args: z
        .object({ id: idSchema, ...textInput })
        .strict()
        .refine(textSource),
      result: postResult,
      auth: "user",
      offline: "online",
    }),
    delete: defineMethod({
      name: "chat.post.delete",
      args: z.object({ id: idSchema }).strict(),
      result: postResult,
      auth: "user",
      offline: "online",
    }),
    body: defineMethod({
      name: "chat.post.body",
      args: z.object({ id: idSchema, ...chunkArgs }).strict(),
      result: chunkResult,
      auth: "user",
      offline: "online",
      body: "out",
    }),
    image: defineMethod({
      name: "chat.post.image",
      args: z
        .object({
          id: idSchema,
          conversation: idSchema,
          upload: idSchema,
          replyTo: idSchema.optional(),
        })
        .strict(),
      result: postResult,
      auth: "user",
      offline: "online",
    }),
  }),
  text: Object.freeze({
    put: defineMethod({
      name: "chat.text.put",
      args: z
        .object({
          id: idSchema,
          offset: revSchema,
          total: z.number().int().min(1).max(CHAT_MAX_TEXT),
          text: z.string().min(1).max(CHAT_TEXT_CHUNK),
        })
        .strict(),
      result: z.object({ offset: revSchema }).strict(),
      auth: "user",
      offline: "queue",
    }),
    fetch: defineMethod({
      name: "chat.text.fetch",
      args: z.object({ id: idSchema, ...chunkArgs }).strict(),
      result: chunkResult,
      auth: "user",
      offline: "online",
      body: "out",
    }),
  }),
  file: Object.freeze({
    fetch: defineMethod({
      name: "chat.file.fetch",
      args: z
        .object({
          conversation: idSchema.optional(),
          rid: hashSchema,
          ...chunkArgs,
        })
        .strict(),
      result: chunkResult,
      auth: "user",
      offline: "online",
      body: "out",
    }),
  }),
  sticker: Object.freeze({
    list: defineMethod({
      name: "chat.sticker.list",
      args: z
        .object({
          offset: revSchema.optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .strict(),
      result: z
        .object({
          stickers: z.array(stickerSchema),
          next: revSchema.nullable(),
        })
        .strict(),
      auth: "user",
      offline: "online",
    }),
  }),
  state: Object.freeze({
    ...defineEntity({ name: "chatState", schema: chatStateSchema }),
    set: defineMethod({
      name: "chat.state.set",
      args: z
        .object({
          conversation: idSchema,
          key: z.enum(["pin", "mute", "draft", "retention"]),
          value: z
            .object({
              v: z.union([z.boolean(), z.string().max(CHAT_TEXT_CHUNK)]),
              t: stampSchema,
              op: idSchema,
            })
            .strict(),
          textId: idSchema.optional(),
        })
        .strict()
        .refine((value) => {
          if (value.textId && value.key !== "draft") return false;
          if (value.key === "pin" || value.key === "mute")
            return typeof value.value.v === "boolean";
          if (value.key === "retention")
            return retentionSchema.safeParse(value.value.v).success;
          return typeof value.value.v === "string";
        }),
      result: z.object({ state: chatStateSchema }).strict(),
      auth: "user",
      offline: "queue",
    }),
    read: defineMethod({
      name: "chat.state.read",
      args: z.object({ conversation: idSchema, seq: revSchema }).strict(),
      result: z.object({ state: chatStateSchema }).strict(),
      auth: "user",
      offline: "queue",
    }),
  }),
  announcement: Object.freeze({
    ...defineEntity({ name: "announcement", schema: announcementSchema }),
    ack: defineMethod({
      name: "chat.announcement.ack",
      args: z.object({ revision: revSchema }).strict(),
      result: okSchema,
      auth: "user",
      offline: "queue",
    }),
    publish: defineMethod({
      name: "chat.announcement.publish",
      args: z
        .object({
          title: z.string().trim().min(1).max(120),
          text: z.string().trim().min(1).max(16000),
        })
        .strict(),
      result: z.object({ announcement: announcementSchema }).strict(),
      auth: "user",
      offline: "online",
    }),
  }),
  announcementAck: defineEntity({
    name: "announcementAck",
    schema: announcementAckSchema,
  }),
  user: Object.freeze({
    mute: defineMethod({
      name: "chat.user.mute",
      args: z.object({ user: idSchema, until: revSchema }).strict(),
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
  }),
});
