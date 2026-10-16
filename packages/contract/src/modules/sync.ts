import { z } from "zod";
import { defineEvent, defineMethod } from "../protocol/definitions.ts";
import { revSchema, jsonSchema } from "../protocol/scalars.ts";
export const MAX_SYNC_ROWS = 1000;
/** Leaves space for the link reply/event envelope under MAX_HEADER_BYTES. */
export const MAX_SYNC_BYTES = 160 * 1024;
export const DEFAULT_SYNC_ROWS = 200;
export const WINDOW_RESET_THRESHOLD = 2000;
export const OP_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const rowSchema = z
  .object({
    type: z.string().min(1),
    id: z.string().min(1),
    rev: revSchema,
    deleted: z.boolean(),
    data: jsonSchema,
  })
  .strict();
export const scopePullSchema = z
  .object({
    rows: z.array(rowSchema),
    cursor: revSchema,
    more: z.boolean(),
    reset: z.array(z.string()).optional(),
  })
  .strict();
export const syncResultSchema = z
  .object({
    scopes: z.record(scopePullSchema),
    gone: z.array(z.string()),
    added: z.array(z.string()),
    transfer: z
      .object({
        token: z.string().min(1).max(128),
        chunk: z.string(),
        more: z.boolean(),
      })
      .strict()
      .optional(),
    repull: z.boolean().optional(),
  })
  .strict();
export const sync = Object.freeze({
  pull: defineMethod({
    name: "sync.pull",
    args: z
      .object({
        cursors: z.record(revSchema),
        /**
         * Scopes holding windowed rows. When present, windowed rows of every other
         * scope are omitted: a client without a window would discard them anyway.
         */
        windowed: z.array(z.string().min(1)).optional(),
        continuation: z.string().min(1).max(128).optional(),
        limit: z.number().int().min(1).max(MAX_SYNC_ROWS).optional(),
      })
      .strict(),
    result: syncResultSchema,
    auth: "user",
    offline: "online",
  }),
  delta: defineEvent({ topic: "sync.delta", data: syncResultSchema }),
});
