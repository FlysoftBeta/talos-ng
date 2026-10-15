import { z } from "zod";
import type { ClientManifest } from "@talos/docpack";
import { compareStamp } from "@talos/base";
import { defineEntity, defineMethod } from "../protocol/definitions.ts";
import {
  idSchema,
  hashSchema,
  revSchema,
  stampSchema,
  okSchema,
} from "../protocol/scalars.ts";
const lww = <T extends z.ZodTypeAny>(v: T) =>
  z.object({ v, t: stampSchema, op: idSchema }).strict();
export const libraryPositionSchema = z
  .object({
    unit: revSchema,
    offset: revSchema,
    unitId: z.string().max(200).optional(),
    charOffset: revSchema.optional(),
    charInset: z.number().finite().optional(),
  })
  .strict();
export const libraryRetentionSchema = z.union([
  z.literal("auto"),
  z.literal(1),
  z.literal(7),
  z.literal(180),
]);
export const libraryDocSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(200),
    owner: idSchema,
    created: revSchema,
    kind: z.enum(["flow", "paged"]).nullable(),
    status: z.enum(["processing", "ready"]),
    pack: z.object({ id: hashSchema, size: revSchema }).nullable(),
    units: revSchema,
    chars: revSchema,
  })
  .strict();
export type LibraryDoc = z.infer<typeof libraryDocSchema>;
export const libraryCollectionSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1).max(200),
    owner: idSchema,
    group: idSchema.nullable(),
    docs: z.array(idSchema).max(1000),
    builtin: z.enum(["shelf", "favourites"]).optional(),
  })
  .strict();
export type LibraryCollection = z.infer<typeof libraryCollectionSchema>;
export const libraryStateSchema = z
  .object({
    id: idSchema,
    favourite: lww(z.boolean()).nullable(),
    resume: lww(libraryPositionSchema).nullable(),
    furthest: revSchema,
    seconds: z.record(idSchema, revSchema),
    retention: lww(libraryRetentionSchema).nullable(),
    lastRead: revSchema,
  })
  .strict();
export type LibraryState = z.infer<typeof libraryStateSchema>;
export const libraryDoc = defineEntity({
  name: "libraryDoc",
  schema: libraryDocSchema,
});
export const libraryCollection = defineEntity({
  name: "libraryCollection",
  schema: libraryCollectionSchema,
});
export const libraryState = defineEntity({
  name: "libraryState",
  schema: libraryStateSchema,
});
const docArgs = z.object({ doc: idSchema }).strict();
const collectionArgs = z.object({ collection: idSchema }).strict();
const imported = z.object({ doc: idSchema, job: idSchema }).strict();
export const libraryProgressInputSchema = z
  .object({
    doc: idSchema,
    resume: lww(libraryPositionSchema),
    furthest: revSchema,
    seconds: revSchema,
    device: idSchema,
  })
  .strict();
export type LibraryProgressInput = z.infer<typeof libraryProgressInputSchema>;
export const libraryGrantSchema = z
  .object({
    id: idSchema,
    principalType: z.enum(["user", "group"]),
    principal: idSchema,
    level: z.enum(["read", "write", "own"]),
    delegate: z.boolean(),
  })
  .strict();
export const libraryGrantInputSchema = z
  .object({
    collection: idSchema,
    principalType: z.enum(["user", "group"]),
    principal: idSchema,
    level: z.enum(["read", "write", "own"]).nullable(),
    delegate: z.boolean(),
  })
  .strict();
export type LibraryGrantInput = z.infer<typeof libraryGrantInputSchema>;
export const libraryDescriptionSchema = z
  .object({
    document: libraryDocSchema,
    pack: z.object({ id: hashSchema, size: revSchema }),
    download: z.object({
      url: z.string(),
      ticket: z.string(),
      expires: revSchema,
    }),
  })
  .strict();
export const library = Object.freeze({
  doc: Object.freeze({
    importText: defineMethod({
      name: "library.doc.importText",
      args: z
        .object({
          title: z.string().trim().min(1).max(200),
          body: z
            .string()
            .trim()
            .min(1)
            .max(180 * 1024),
          collection: idSchema.optional(),
        })
        .strict(),
      result: imported,
      auth: "user",
      offline: "online",
    }),
    importFile: defineMethod({
      name: "library.doc.importFile",
      args: z
        .object({
          title: z.string().trim().min(1).max(200),
          name: z.string().min(1).max(255),
          upload: idSchema,
          collection: idSchema.optional(),
        })
        .strict(),
      result: imported,
      auth: "user",
      offline: "online",
    }),
    open: defineMethod({
      name: "library.doc.open",
      args: docArgs,
      result: libraryDescriptionSchema.extend({
        manifest: z.custom<ClientManifest>(
          (v: unknown) => !!v && typeof v === "object" && "v" in v && v.v === 1,
        ),
      }),
      auth: "user",
      offline: "online",
    }),
    describe: defineMethod({
      name: "library.doc.describe",
      args: docArgs,
      result: libraryDescriptionSchema,
      auth: "user",
      offline: "online",
    }),
    fetch: defineMethod({
      name: "library.doc.fetch",
      args: z
        .object({ doc: idSchema, rids: z.array(hashSchema).min(1).max(64) })
        .strict(),
      result: okSchema,
      auth: "user",
      offline: "online",
      body: "out",
    }),
    delete: defineMethod({
      name: "library.doc.delete",
      args: docArgs,
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
  }),
  collection: Object.freeze({
    transfer: defineMethod({
      name: "library.collection.transfer",
      args: z
        .object({ source: idSchema, target: idSchema, doc: idSchema })
        .strict(),
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
    create: defineMethod({
      name: "library.collection.create",
      args: z
        .object({
          title: z.string().trim().min(1).max(200),
          group: idSchema.optional(),
        })
        .strict(),
      result: z.object({ id: idSchema }).strict(),
      auth: "user",
      offline: "online",
    }),
    items: defineMethod({
      name: "library.collection.items",
      args: z
        .object({ collection: idSchema, docs: z.array(idSchema).max(1000) })
        .strict(),
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
    delete: defineMethod({
      name: "library.collection.delete",
      args: collectionArgs,
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
  }),
  sharing: Object.freeze({
    principals: defineMethod({
      name: "library.sharing.principals",
      args: z.object({ query: z.string().max(100).optional() }).strict(),
      result: z.object({
        principals: z.array(
          z.object({
            id: idSchema,
            type: z.enum(["user", "group"]),
            name: z.string(),
          }),
        ),
      }),
      auth: "user",
      offline: "online",
    }),
    list: defineMethod({
      name: "library.sharing.list",
      args: collectionArgs,
      result: z.object({
        grants: z.array(libraryGrantSchema),
        canShare: z.boolean(),
      }),
      auth: "user",
      offline: "online",
    }),
    set: defineMethod({
      name: "library.sharing.set",
      args: libraryGrantInputSchema,
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
  }),
  favourite: Object.freeze({
    set: defineMethod({
      name: "library.favourite.set",
      args: z.object({ doc: idSchema, value: lww(z.boolean()) }).strict(),
      result: okSchema,
      auth: "user",
      offline: "queue",
    }),
  }),
  progress: Object.freeze({
    set: defineMethod({
      name: "library.progress.set",
      args: libraryProgressInputSchema,
      result: okSchema,
      auth: "user",
      offline: "queue",
    }),
  }),
  retention: Object.freeze({
    set: defineMethod({
      name: "library.retention.set",
      args: z
        .object({ doc: idSchema, value: lww(libraryRetentionSchema) })
        .strict(),
      result: okSchema,
      auth: "user",
      offline: "queue",
    }),
  }),
});
export const libraryMethods = [
  ...Object.values(library.doc),
  ...Object.values(library.collection),
  ...Object.values(library.sharing),
  library.favourite.set,
  library.progress.set,
  library.retention.set,
];
export function emptyLibraryState(id: string): LibraryState {
  return {
    id,
    favourite: null,
    resume: null,
    furthest: 0,
    seconds: {},
    retention: null,
    lastRead: 0,
  };
}
export function applyLibraryProgress(
  state: LibraryState,
  input: LibraryProgressInput,
): LibraryState {
  return {
    ...state,
    resume: state.resume
      ? compareStamp(state.resume.t, input.resume.t) > 0 ||
        (compareStamp(state.resume.t, input.resume.t) === 0 &&
          state.resume.op >= input.resume.op)
        ? state.resume
        : input.resume
      : input.resume,
    furthest: Math.max(state.furthest, input.furthest),
    seconds: {
      ...state.seconds,
      [input.device]: Math.max(state.seconds[input.device] ?? 0, input.seconds),
    },
    lastRead: Math.max(state.lastRead, input.resume.t.ms),
  };
}
