import { z } from "zod";
import { defineEntity, defineMethod } from "../protocol/definitions.ts";
import {
  idSchema,
  jsonSchema,
  okSchema,
  revSchema,
} from "../protocol/scalars.ts";
export const job = defineEntity({
  name: "job",
  schema: z
    .object({
      id: idSchema,
      kind: z.string(),
      title: z.string().max(500).default(""),
      owner: idSchema,
      state: z.enum(["queued", "running", "done", "failed", "cancelled"]),
      progress: z.number().min(0).max(1),
      message: z.string(),
      result: jsonSchema,
      error: jsonSchema,
      attempts: revSchema,
      created: revSchema,
      updated: revSchema,
      retryable: z.boolean().default(false),
      etaMs: z.number().int().nonnegative().nullable().default(null),
    })
    .strict(),
});
export const tasks = Object.freeze({
  job,
  retry: defineMethod({
    name: "tasks.retry",
    args: z.object({ id: idSchema }).strict(),
    result: okSchema,
    auth: "user",
    offline: "online",
  }),
  cancel: defineMethod({
    name: "tasks.cancel",
    args: z.object({ id: idSchema }).strict(),
    result: okSchema,
    auth: "user",
    offline: "online",
  }),
  clear: defineMethod({
    name: "tasks.clear",
    args: z.object({ id: idSchema.optional() }).strict(),
    result: okSchema,
    auth: "user",
    offline: "online",
  }),
});
