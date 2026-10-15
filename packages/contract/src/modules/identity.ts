import { z } from "zod";
import { defineMethod } from "../protocol/definitions.ts";
import { emptySchema, idSchema, revSchema } from "../protocol/scalars.ts";
import { sessionSchema, userSchema } from "./auth.ts";
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const PIN_FAILURE_LIMIT = 5;
export const PIN_THROTTLE_MS = 15 * 60 * 1000;
export const pinSchema = z.string().regex(/^\d{6}$/);
export const pinsSchema = z
  .array(pinSchema)
  .min(1)
  .max(2)
  .refine((pins) => new Set(pins).size === pins.length, "PIN 不可重复");
export const handleSchema = z.string().regex(/^[A-Za-z0-9_]{1,20}$/);
export const displayNameSchema = z.string().trim().min(1).max(30);
export const invitationTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const identity = Object.freeze({
  invitation: Object.freeze({
    create: defineMethod({
      name: "identity.invitation.create",
      args: emptySchema,
      result: z
        .object({ id: idSchema, pin: pinSchema, expires: revSchema })
        .strict(),
      auth: "user",
      offline: "online",
    }),
  }),
  onboarding: Object.freeze({
    complete: defineMethod({
      name: "identity.onboarding.complete",
      args: z
        .object({
          invitationToken: invitationTokenSchema,
          pins: pinsSchema,
          handle: handleSchema,
          name: displayNameSchema,
        })
        .strict(),
      result: sessionSchema,
      auth: "device",
      offline: "online",
    }),
  }),
  profile: Object.freeze({
    update: defineMethod({
      name: "identity.profile.update",
      args: z
        .object({
          handle: handleSchema.optional(),
          name: displayNameSchema.optional(),
        })
        .strict()
        .refine(
          (value) => value.handle !== undefined || value.name !== undefined,
        ),
      result: z.object({ user: userSchema }).strict(),
      auth: "user",
      offline: "online",
    }),
  }),
  pins: Object.freeze({
    replace: defineMethod({
      name: "identity.pins.replace",
      args: z.object({ currentPin: pinSchema, pins: pinsSchema }).strict(),
      result: z
        .object({ ok: z.literal(true), credentialVersion: revSchema })
        .strict(),
      auth: "user",
      offline: "online",
    }),
  }),
});
