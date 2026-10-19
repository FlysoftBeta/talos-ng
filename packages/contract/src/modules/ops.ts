import { z } from "zod";
import { defineMethod } from "../protocol/definitions.ts";
import { idSchema, okSchema } from "../protocol/scalars.ts";
/** Shared policy vocabulary: server decisions and synced client capability checks. */
export const OPS_ACTION_ROLES = {
  "ops.enter": "root",
  "ops.settings.get": "administrator",
  "ops.settings.set": "root",
  "ops.backup.list": "administrator",
  "ops.backup.create": "administrator",
  "ops.backup.delete": "administrator",
  "ops.backup.download": "administrator",
  "ops.update.status": "administrator",
  "ops.update.stage": "root",
  "ops.update.apply": "root",
  "ops.update.confirm": "root",
  "ops.update.check": "root",
  "ops.update.install": "root",
  "ops.https.status": "administrator",
  "ops.host.status": "root",
  "ops.host.run": "root",
  "ops.office.list": "administrator",
  "ops.office.refresh": "administrator",
  "ops.office.clear": "administrator",
  "ops.office.download": "administrator",
} as const;
export type OpsAction = keyof typeof OPS_ACTION_ROLES;
export function opsActionRole(
  action: string,
): "root" | "administrator" | undefined {
  return Object.prototype.hasOwnProperty.call(OPS_ACTION_ROLES, action)
    ? OPS_ACTION_ROLES[action as OpsAction]
    : undefined;
}
const objectIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const empty = z.object({}).strict();
const id = z.object({ id: idSchema }).strict();
const download = z
  .object({ ticket: z.string(), url: z.string(), expires: z.number() })
  .strict();
const backup = z
  .object({ id: idSchema, created: z.number(), size: z.number() })
  .strict();
const office = z
  .object({
    id: idSchema,
    name: z.string(),
    application: z.string(),
    kind: z.enum(["word", "powerpoint", "excel"]),
    objectId: objectIdSchema,
    size: z.number(),
    created: z.number(),
  })
  .strict();
export const opsSettings = z
  .object({
    retention: z.number().int().min(1).max(100),
    daily: z.boolean(),
    cloudEnabled: z.boolean(),
    autoCheck: z.boolean(),
    manifestUrl: z.string().max(2048),
  })
  .strict();
export const updateStatus = z
  .object({
    build: z.string(),
    phase: z.enum(["idle", "checking", "staging", "staged", "pending"]),
    candidate: z.string().nullable(),
    progress: z.number().min(0).max(1),
    lastError: z.string().nullable(),
    launcher: z.boolean(),
  })
  .strict();
export const httpsStatus = z
  .object({
    domain: z.string().nullable(),
    listeners: z.array(
      z.object({ port: z.number(), secure: z.boolean(), host: z.string() }),
    ),
    expiry: z.number().nullable(),
    redirect: z.boolean(),
    ca: z.boolean(),
  })
  .strict();
/** Longest scheduled shutdown delay: one day. */
export const SHUTDOWN_MAX_MINUTES = 1440;
export const hostStatus = z
  .object({
    available: z.boolean(),
    /** When the pending shutdown this server scheduled happens. */
    shutdownAt: z.number().nullable(),
  })
  .strict();
const hostCommand = z.discriminatedUnion("action", [
  /** Close folder windows, Office, WPS, Seewo EasiNote and the visualiser. */
  z.object({ action: z.literal("reset-classroom") }).strict(),
  /** Zero minutes shuts down after a short grace; a later schedule replaces an earlier one. */
  z
    .object({
      action: z.literal("shutdown"),
      delayMinutes: z.number().int().min(0).max(SHUTDOWN_MAX_MINUTES),
    })
    .strict(),
  z.object({ action: z.literal("cancel-shutdown") }).strict(),
]);
function method<
  N extends string,
  A extends z.ZodTypeAny,
  R extends z.ZodTypeAny,
>(name: N, args: A, result: R) {
  return defineMethod({ name, args, result, auth: "user", offline: "online" });
}
export const ops = Object.freeze({
  settings: {
    get: method("ops.settings.get", empty, opsSettings),
    set: method("ops.settings.set", opsSettings, opsSettings),
  },
  backup: {
    list: method("ops.backup.list", empty, z.array(backup)),
    create: method("ops.backup.create", empty, backup),
    delete: method("ops.backup.delete", id, okSchema),
    download: method("ops.backup.download", id, download),
  },
  update: {
    status: method("ops.update.status", empty, updateStatus),
    stage: method(
      "ops.update.stage",
      z.object({ upload: idSchema }).strict(),
      updateStatus,
    ),
    apply: method("ops.update.apply", empty, okSchema),
    confirm: method("ops.update.confirm", empty, okSchema),
    check: method("ops.update.check", empty, updateStatus),
    install: method("ops.update.install", empty, updateStatus),
  },
  https: { status: method("ops.https.status", empty, httpsStatus) },
  host: {
    status: method("ops.host.status", empty, hostStatus),
    run: method("ops.host.run", hostCommand, hostStatus),
  },
  office: {
    list: method(
      "ops.office.list",
      empty,
      z.object({ available: z.boolean(), files: z.array(office) }),
    ),
    refresh: method(
      "ops.office.refresh",
      empty,
      z.object({ available: z.boolean(), files: z.array(office) }),
    ),
    clear: method("ops.office.clear", empty, okSchema),
    download: method("ops.office.download", id, download),
  },
});
export const opsMethods = [
  ops.settings.get,
  ops.settings.set,
  ops.backup.list,
  ops.backup.create,
  ops.backup.delete,
  ops.backup.download,
  ops.update.status,
  ops.update.stage,
  ops.update.apply,
  ops.update.confirm,
  ops.update.check,
  ops.update.install,
  ops.https.status,
  ops.host.status,
  ops.host.run,
  ops.office.list,
  ops.office.refresh,
  ops.office.clear,
  ops.office.download,
] as const;
