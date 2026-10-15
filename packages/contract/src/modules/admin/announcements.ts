import { z } from "zod";
import { defineMethod } from "../../protocol/definitions.ts";
import { revSchema } from "../../protocol/scalars.ts";
import { announcementSchema } from "../chat.ts";
import { pageArgs } from "./paging.ts";

export const adminAnnouncementMethods = Object.freeze({
  list: defineMethod({
    name: "admin.announcement.list",
    args: pageArgs,
    result: z
      .object({
        items: z.array(
          announcementSchema.extend({
            acknowledged: revSchema,
            audience: revSchema,
          }),
        ),
        total: revSchema,
      })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  publish: defineMethod({
    name: "admin.announcement.publish",
    args: z
      .object({
        title: z.string().trim().min(1).max(120),
        text: z.string().trim().min(1).max(10000),
      })
      .strict(),
    result: z.object({ announcement: announcementSchema }).strict(),
    auth: "user",
    offline: "online",
  }),
});
