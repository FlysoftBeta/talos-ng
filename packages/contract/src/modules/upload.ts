import { z } from "zod";
import { defineMethod } from "../protocol/definitions.ts";
import {
  hashSchema,
  idSchema,
  okSchema,
  revSchema,
} from "../protocol/scalars.ts";
export const UPLOAD_LIMITS = Object.freeze({
  file: 512 * 1024 * 1024,
  document: 200 * 1024 * 1024,
  image: 12 * 1024 * 1024,
  audio: 200 * 1024 * 1024,
});
export const upload = Object.freeze({
  ticket: defineMethod({
    name: "upload.ticket",
    args: z
      .object({
        id: idSchema,
        filename: z.string().min(1).max(255),
        mime: z.string().min(1).max(255),
      })
      .strict(),
    result: z
      .object({ ticket: z.string(), url: z.string(), expires: revSchema })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  begin: defineMethod({
    name: "upload.begin",
    args: z
      .object({
        id: idSchema.optional(),
        kind: z.enum(["file", "image", "document", "audio"]),
        size: revSchema,
        sha256: hashSchema.optional(),
      })
      .strict(),
    result: z.object({ id: idSchema, offset: revSchema }).strict(),
    auth: "user",
    offline: "online",
  }),
  append: defineMethod({
    name: "upload.append",
    args: z.object({ id: idSchema, offset: revSchema }).strict(),
    result: z.object({ offset: revSchema }).strict(),
    auth: "user",
    offline: "online",
    body: "in",
  }),
  commit: defineMethod({
    name: "upload.commit",
    args: z.object({ id: idSchema }).strict(),
    result: z
      .object({
        id: idSchema,
        object: z.object({ id: hashSchema, size: revSchema }).strict(),
      })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  abort: defineMethod({
    name: "upload.abort",
    args: z.object({ id: idSchema }).strict(),
    result: okSchema,
    auth: "user",
    offline: "online",
  }),
});
