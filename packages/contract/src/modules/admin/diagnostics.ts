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
