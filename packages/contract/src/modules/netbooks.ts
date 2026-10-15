import { z } from "zod";
import { defineMethod } from "../protocol/definitions.ts";
import { idSchema, revSchema } from "../protocol/scalars.ts";
export const netbookSchema = z
  .object({
    id: z.string().regex(/^\d{1,30}$/),
    title: z.string().min(1).max(200),
    author: z.string().max(200),
    abstract: z.string().max(81),
  })
  .strict();
export type Netbook = z.infer<typeof netbookSchema>;
export const netbooks = Object.freeze({
  search: defineMethod({
    name: "netbooks.search",
    args: z.object({ query: z.string().trim().min(1).max(100) }).strict(),
    result: z
      .object({
        books: z.array(netbookSchema).max(20),
        retryAt: revSchema,
        serverTime: revSchema,
      })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  download: defineMethod({
    name: "netbooks.download",
    args: z
      .object({ book: z.string().regex(/^\d{1,30}$/), collection: idSchema })
      .strict(),
    result: z.object({ job: idSchema, joined: z.boolean() }).strict(),
    auth: "user",
    offline: "online",
  }),
});
