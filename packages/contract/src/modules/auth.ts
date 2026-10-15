import { z } from "zod";
import { defineMethod } from "../protocol/definitions.ts";
import {
  emptySchema,
  idSchema,
  okSchema,
  revSchema,
} from "../protocol/scalars.ts";
import { featureSchema } from "../policy/features.ts";
import { adminRoleSchema } from "../policy/roles.ts";
export const userSchema = z
  .object({
    id: idSchema,
    name: z.string().max(30),
    handle: z.string().max(20),
    roles: z.array(adminRoleSchema),
    features: z.array(featureSchema),
    bannedUntil: z.number().int().nonnegative().nullable().optional(),
    credentialVersion: revSchema.optional(),
  })
  .strict();
export const sessionSchema = z
  .object({
    user: userSchema,
    token: z.string().regex(/^[a-f0-9]{64}$/),
    expires: revSchema,
    credentialVersion: revSchema.optional(),
  })
  .strict();
export const auth = Object.freeze({
  device: Object.freeze({
    register: defineMethod({
      name: "auth.device.register",
      args: z.object({ label: z.string().max(1000).optional() }).strict(),
      result: z.object({ device: idSchema }).strict(),
      auth: "public",
      offline: "online",
    }),
  }),
  login: defineMethod({
    name: "auth.login",
    args: z.object({ pin: z.string().regex(/^\d{6}$/) }).strict(),
    result: z.union([
      sessionSchema,
      z
        .object({
          onboarding: z.literal(true),
          invitationToken: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ]),
    auth: "device",
    offline: "online",
  }),
  resume: defineMethod({
    name: "auth.resume",
    args: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    result: sessionSchema,
    auth: "device",
    offline: "online",
  }),
  logout: defineMethod({
    name: "auth.logout",
    args: z
      .object({
        token: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .strict(),
    result: okSchema,
    auth: "device",
    offline: "online",
  }),
  lock: defineMethod({
    name: "auth.lock",
    args: emptySchema,
    result: okSchema,
    auth: "user",
    offline: "online",
  }),
});
export type User = z.infer<typeof userSchema>;
