import { z } from "zod";
import { defineMethod } from "../../protocol/definitions.ts";
import {
  emptySchema,
  idSchema,
  okSchema,
  revSchema,
} from "../../protocol/scalars.ts";
import { pageArgs } from "./paging.ts";

const auditSchema = z
  .object({
    id: idSchema,
    actor: idSchema.nullable(),
    action: z.string(),
    target: z.string().nullable(),
    details: z.string(),
    created: revSchema,
  })
  .strict();
const provenance = {
  source: z.enum(["client", "server"]),
  build: z.string(),
  environment: z.string(),
};
const incidentSchema = z
  .object({
    id: idSchema,
    ...provenance,
    fingerprint: z.string(),
    count: z.number().int().positive(),
    first: revSchema,
    last: revSchema,
    summary: z.string(),
  })
  .strict();
export const adminAuditMethods = Object.freeze({
  list: defineMethod({
    name: "admin.audit.list",
    args: pageArgs,
    result: z
      .object({ items: z.array(auditSchema), total: revSchema })
      .strict(),
    auth: "user",
    offline: "online",
  }),
});
export const adminIncidentMethods = Object.freeze({
  report: defineMethod({
    name: "admin.incident.report",
    args: z
      .object({
        name: z.string().max(32),
        stack: z.string().max(2048),
        kind: z.enum(["error", "unhandledrejection", "operation"]),
        build: z.string().max(128),
        environment: z.string().max(512),
      })
      .strict(),
    result: okSchema,
    auth: "user",
    offline: "online",
  }),
  list: defineMethod({
    name: "admin.incident.list",
    args: pageArgs.extend({
      source: z.enum(["client", "server"]).optional(),
      build: z.string().max(128).optional(),
      environment: z.string().max(512).optional(),
      level: z.string().optional(),
      module: z.string().optional(),
      from: revSchema.optional(),
      to: revSchema.optional(),
      query: z.string().optional(),
    }),
    result: z
      .object({ items: z.array(incidentSchema), total: revSchema })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  detail: defineMethod({
    name: "admin.incident.detail",
    args: z.object({ id: idSchema }).strict(),
    result: z
      .object({
        id: idSchema,
        summary: z.string(),
        ...provenance,
        stack: z.string(),
        level: z.string(),
        module: z.string(),
        relatedIds: z.array(idSchema),
        count: z.number().int(),
        first: revSchema,
        last: revSchema,
      })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  download: defineMethod({
    name: "admin.incident.download",
    args: emptySchema,
    result: z
      .object({ ticket: z.string(), url: z.string(), expires: revSchema })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  selfTest: defineMethod({
    name: "admin.incident.selfTest",
    args: z
      .object({ source: z.enum(["server", "client"]).optional() })
      .strict(),
    result: z.object({ id: idSchema }).strict(),
    auth: "user",
    offline: "online",
  }),
});

const source = z.enum(["writer", "reader"]);
const kind = z.enum(["statement", "transaction"]);
const ms = z.number().nonnegative();
const performanceSchema = z
  .object({
    queries: z
      .object({
        since: revSchema,
        slowMs: ms,
        statements: z.array(
          z
            .object({
              source,
              kind,
              sql: z.string(),
              count: z.number().int().nonnegative(),
              totalMs: ms,
              p50Ms: ms,
              p95Ms: ms,
              maxMs: ms,
              slow: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        recentSlow: z.array(
          z
            .object({ source, kind, sql: z.string(), ms, at: revSchema })
            .strict(),
        ),
        dropped: z.number().int().nonnegative(),
      })
      .strict(),
    eventLoop: z
      .object({
        since: revSchema,
        p50Ms: ms,
        p99Ms: ms,
        maxMs: ms,
        meanMs: ms,
        utilization: z.number().min(0).max(1),
      })
      .strict(),
    replicas: z
      .object({
        size: z.number().int(),
        ready: z.number().int(),
        busy: z.number().int(),
        completed: z.number().int(),
        failed: z.number().int(),
        restarts: z.number().int(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type AdminPerformance = z.infer<typeof performanceSchema>;
export const adminPerformanceMethods = Object.freeze({
  get: defineMethod({
    name: "admin.performance.get",
    args: z.object({ reset: z.boolean().optional() }).strict(),
    result: performanceSchema,
    auth: "user",
    offline: "online",
  }),
});
