import { z } from "zod";
import { defineEntity, defineMethod } from "../protocol/definitions.ts";
import {
  emptySchema,
  hashSchema,
  idSchema,
  okSchema,
  revSchema,
  stampSchema,
} from "../protocol/scalars.ts";

export const mediaRetentionSchema = z.union([
  z.literal("auto"),
  z.number().int().min(1).max(365),
]);
export const mediaRetentionEntitySchema = z
  .object({
    id: idSchema,
    kind: z.enum(["track", "playlist"]),
    value: z
      .object({ v: mediaRetentionSchema, t: stampSchema, op: idSchema })
      .strict()
      .nullable(),
    lastUsed: revSchema,
  })
  .strict();
export type MediaRetention = z.infer<typeof mediaRetentionEntitySchema>;
export const mediaRetention = defineEntity({
  name: "mediaRetention",
  schema: mediaRetentionEntitySchema,
});
const ref = z
  .object({
    source: z.string().min(1).max(40),
    providerId: z.string().min(1).max(200),
  })
  .strict();
export const mediaTrackSchema = z
  .object({
    id: idSchema,
    source: ref.shape.source,
    providerId: ref.shape.providerId,
    title: z.string().min(1).max(200),
    artists: z.array(z.string()).max(20),
    album: z.string().nullable(),
    durationMs: revSchema,
    audio: z
      .object({ id: hashSchema, size: revSchema, mime: z.string() })
      .strict()
      .nullable(),
  })
  .strict();
export type MediaTrack = z.infer<typeof mediaTrackSchema>;
export const mediaPlaylistSchema = z
  .object({
    id: idSchema,
    owner: idSchema,
    title: z.string().min(1).max(80),
    tracks: z.array(idSchema).max(500),
    created: revSchema,
  })
  .strict();
export type MediaPlaylist = z.infer<typeof mediaPlaylistSchema>;
export const mediaUserStateSchema = z
  .object({
    id: idSchema,
    favorites: z.record(
      idSchema,
      z.object({ v: z.boolean(), t: stampSchema, op: idSchema }).strict(),
    ),
    queue: z.array(idSchema).max(500),
    queueStamp: z.object({ t: stampSchema, op: idSchema }).strict().nullable(),
    recents: z.array(idSchema).max(12),
    stopAtEnd: z.boolean(),
    stopStamp: z.object({ t: stampSchema, op: idSchema }).strict().nullable(),
  })
  .strict();
export type MediaUserState = z.infer<typeof mediaUserStateSchema>;
export const mediaTrack = defineEntity({
  name: "mediaTrack",
  schema: mediaTrackSchema,
});
export const mediaPlaylist = defineEntity({
  name: "mediaPlaylist",
  schema: mediaPlaylistSchema,
});
export const mediaUserState = defineEntity({
  name: "mediaUserState",
  schema: mediaUserStateSchema,
});
const track = z.object({ track: idSchema }).strict();
const playlist = z.object({ playlist: idSchema }).strict();
const stamp = z.object({ t: stampSchema, op: idSchema }).strict();
const queue = z
  .object({ tracks: z.array(idSchema).max(500), ...stamp.shape })
  .strict();
const result = z.object({ track: mediaTrackSchema }).strict();
const playlistResult = z.object({ playlist: mediaPlaylistSchema }).strict();
export const media = Object.freeze({
  retention: Object.freeze({
    set: defineMethod({
      name: "media.retention.set",
      args: z
        .object({
          kind: z.enum(["track", "playlist"]),
          id: idSchema,
          value: mediaRetentionEntitySchema.shape.value.unwrap(),
        })
        .strict(),
      result: okSchema,
      auth: "user",
      offline: "queue",
    }),
  }),
  recordPlay: defineMethod({
    name: "media.track.recordPlay",
    args: track.extend(stamp.shape),
    result: okSchema,
    auth: "user",
    offline: "queue",
  }),
  search: defineMethod({
    name: "media.search",
    args: z
      .object({
        query: z.string().trim().min(1).max(100),
        limit: z.number().int().min(1).max(50).default(20),
      })
      .strict(),
    result: z.object({ tracks: z.array(mediaTrackSchema) }).strict(),
    auth: "user",
    offline: "online",
  }),
  resolve: defineMethod({
    name: "media.track.resolve",
    args: ref,
    result,
    auth: "user",
    offline: "online",
  }),
  library: defineMethod({
    name: "media.library.get",
    args: emptySchema,
    result: z
      .object({
        tracks: z.array(mediaTrackSchema),
        playlists: z.array(mediaPlaylistSchema),
        state: mediaUserStateSchema,
        maxVolume: z.number().min(0).max(1),
      })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  play: defineMethod({
    name: "media.track.play",
    args: track,
    result: z
      .object({
        track: mediaTrackSchema,
        download: z
          .object({ url: z.string(), ticket: z.string(), expires: revSchema })
          .strict()
          .nullable(),
        job: idSchema.nullable(),
        maxVolume: z.number().min(0).max(1),
      })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  prepare: defineMethod({
    name: "media.track.prepare",
    args: track,
    result: z
      .object({
        track: mediaTrackSchema,
        download: z
          .object({ url: z.string(), ticket: z.string(), expires: revSchema })
          .strict()
          .nullable(),
        job: idSchema.nullable(),
      })
      .strict(),
    auth: "user",
    offline: "online",
  }),
  favorite: defineMethod({
    name: "media.favorite.set",
    args: track.extend({
      value: z.object({ v: z.boolean(), ...stamp.shape }).strict(),
    }),
    result: okSchema,
    auth: "user",
    offline: "queue",
  }),
  queue: defineMethod({
    name: "media.queue.set",
    args: queue,
    result: okSchema,
    auth: "user",
    offline: "queue",
  }),
  stopAtEnd: defineMethod({
    name: "media.stopAtEnd.set",
    args: z.object({ value: z.boolean(), ...stamp.shape }).strict(),
    result: okSchema,
    auth: "user",
    offline: "queue",
  }),
  playlist: Object.freeze({
    create: defineMethod({
      name: "media.playlist.create",
      args: z.object({ title: z.string().trim().min(1).max(80) }).strict(),
      result: playlistResult,
      auth: "user",
      offline: "online",
    }),
    delete: defineMethod({
      name: "media.playlist.delete",
      args: playlist,
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
    items: defineMethod({
      name: "media.playlist.items",
      args: playlist.extend({ tracks: z.array(idSchema).max(500) }),
      result: playlistResult,
      auth: "user",
      offline: "online",
    }),
    recordPlay: defineMethod({
      name: "media.playlist.recordPlay",
      args: playlist.extend(stamp.shape),
      result: okSchema,
      auth: "user",
      offline: "queue",
    }),
    share: defineMethod({
      name: "media.playlist.share",
      args: playlist.extend({
        principalType: z.enum(["user", "group"]),
        principal: idSchema,
        level: z.enum(["read", "write", "own"]).nullable(),
      }),
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
    grants: defineMethod({
      name: "media.playlist.grants",
      args: playlist,
      result: z
        .object({
          grants: z.array(
            z
              .object({
                id: idSchema,
                principalType: z.enum(["user", "group"]),
                principal: idSchema,
                level: z.enum(["read", "write", "own"]),
              })
              .strict(),
          ),
          canShare: z.boolean(),
        })
        .strict(),
      auth: "user",
      offline: "online",
    }),
    principals: defineMethod({
      name: "media.playlist.principals",
      args: emptySchema,
      result: z
        .object({
          principals: z.array(
            z
              .object({
                id: idSchema,
                type: z.enum(["user", "group"]),
                name: z.string(),
              })
              .strict(),
          ),
        })
        .strict(),
      auth: "user",
      offline: "online",
    }),
  }),
});
export const mediaMethods = [
  media.retention.set,
  media.recordPlay,
  media.search,
  media.resolve,
  media.library,
  media.play,
  media.prepare,
  media.favorite,
  media.queue,
  media.stopAtEnd,
  ...Object.values(media.playlist),
];
