import { ERROR_CODES } from "@talos/base";
import { z } from "zod";
import { defineEvent, defineMethod } from "../protocol/definitions.ts";
import { revSchema, jsonSchema } from "../protocol/scalars.ts";
export const MAX_SYNC_ROWS = 1000;
export const MAX_PUSH_OPS = 32;
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
    /** Windowed rows are included; otherwise the server omitted them. */
    windowed: z.boolean().optional(),
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
         * Scopes holding windowed rows. Windowed rows of every other scope are
         * omitted: a client without a window would discard them anyway.
         */
        windowed: z.array(z.string().min(1)).default([]),
        continuation: z.string().min(1).max(128).optional(),
        limit: z.number().int().min(1).max(MAX_SYNC_ROWS).optional(),
      })
      .strict(),
    result: syncResultSchema,
    auth: "user",
    offline: "online",
  }),
  /**
   * Queued operations sent together. Entries are mutually independent (the client
   * never batches two operations whose order matters), each keeps its own
   * idempotency key, and each gets its own result.
   */
  push: defineMethod({
    name: "sync.push",
    args: z
      .object({
        ops: z
          .array(
            z
              .object({
                op: z.string().min(1).max(64),
                method: z.string().min(1).max(128),
                args: jsonSchema,
              })
              .strict(),
          )
          .min(1)
          .max(MAX_PUSH_OPS),
      })
      .strict(),
    result: z
      .object({
        results: z.array(
          z
            .object({
              op: z.string(),
              error: z
                .object({
                  code: z.enum(ERROR_CODES),
                  message: z.string(),
                  data: z.unknown().optional(),
                })
                .optional(),
            })
            .strict(),
        ),
      })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  delta: defineEvent({ topic: "sync.delta", data: syncResultSchema }),
});
