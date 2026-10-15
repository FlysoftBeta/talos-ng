import { z } from "zod";
import { defineMethod } from "../protocol/definitions.ts";
import { emptySchema, revSchema } from "../protocol/scalars.ts";
export const sys = Object.freeze({
  info: defineMethod({
    name: "sys.info",
    args: emptySchema,
    result: z
      .object({ version: z.number().int(), build: z.string(), now: revSchema })
      .strict(),
    auth: "public",
    offline: "online",
  }),
  time: defineMethod({
    name: "sys.time",
    args: emptySchema,
    result: z.object({ now: revSchema }).strict(),
    auth: "public",
    offline: "online",
  }),
});
