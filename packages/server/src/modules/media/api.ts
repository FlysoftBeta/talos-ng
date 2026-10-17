import type { MediaPolicy } from "../admin/ports.ts";
import { AppError } from "@talos/base";
import { contract } from "@talos/contract";
import type { LinkHost } from "../../kernel/transport/link-host.ts";
import type { TicketService } from "../../kernel/objects/tickets.ts";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import type { MediaService } from "./service.ts";
import type { AuthorityService } from "../authority/index.ts";
import type { CommunityService } from "../community/index.ts";
import { MediaAccess } from "./access.ts";
import { registerMediaSync } from "./sync.ts";
export function registerMediaApi(
  host: LinkHost,
  service: MediaService,
  authority: AuthorityService,
  community: CommunityService,
  tickets: TicketService,
  hub: SyncHub,
  policy: MediaPolicy,
): void {
  const access = new MediaAccess(service, authority, community);
  registerMediaSync(hub, service, authority, access);
  const enabled = (user: string) => {
    if (!authority.can(user, "feature.use", { feature: "media" }))
      throw new AppError("E_DENIED", "当前账号未获音乐授权");
  };
  const can = (
    user: string,
    id: string,
    level: "read" | "write" | "own" = "read",
  ) => {
    enabled(user);
    const p = service.playlist(id);
    if (
      !access.playlist(user, p) ||
      !authority.can(user, `resource.${level}`, {
        id: `coll:${id}`,
        owner: p.owner,
      })
    )
      throw new AppError("E_DENIED", "没有此歌单的访问权限");
    return p;
  };
  const trackAccess = (user: string, id: string) => {
    enabled(user);
    access.require(user, id);
  };
  const sharePower = (user: string, id: string): number => {
    const p = can(user, id);
    if (p.owner === user) return 3;
    const groups = community.groups(user);
    return authority.repo
      .grants(`coll:${id}`)
      .reduce(
        (power, g) =>
          (
            g.principal_type === "user"
              ? g.principal === user
              : groups.includes(g.principal)
          )
            ? Math.max(power, { read: 1, write: 2, own: 3 }[g.level])
            : power,
        0,
      );
  };
  host.register(contract.media.search, async (ctx, args, _body, signal) => {
    enabled(ctx.user!);
    return {
      tracks: await service.search(
        args.query,
        args.limit ?? 20,
        ctx.user!,
        signal,
      ),
    };
  });
  host.register(contract.media.resolve, (ctx, args) => {
    enabled(ctx.user!);
    const row = service.repo.source(args.source, args.providerId);
    if (!row)
      throw new AppError("E_DENIED", "请先搜索曲目或打开有权访问的歌单");
    access.require(ctx.user!, row.id);
    return { track: service.track(row.id) };
  });
  host.register(contract.media.library, (ctx) => {
    enabled(ctx.user!);
    const state = access.state(ctx.user!);
    const ids = new Set([
      ...state.recents,
      ...state.queue,
      ...Object.keys(state.favorites),
    ]);
    const playlists = access.playlists(ctx.user!);
    for (const p of playlists) for (const id of p.tracks) ids.add(id);
    return {
      tracks: [...ids]
        .filter((id) => access.track(ctx.user!, id))
        .map((id) => service.track(id)),
      playlists,
      state,
      maxVolume: policy.maxVolume(),
    };
  });
  host.register(contract.media.play, (ctx, args) => {
    trackAccess(ctx.user!, args.track);
    const result = service.play(ctx.user!, args.track);
    const audio = result.track.audio;
    return {
      ...result,
      download: audio
        ? tickets.issue({
            objectId: audio.id,
            user: ctx.user!,
            filename: `${result.track.title.replace(/[\x00-\x1f\\/]/g, "_")}.audio`,
            mime: audio.mime,
          })
        : null,
      maxVolume: policy.maxVolume(),
    };
  });
  host.register(contract.media.prepare, (ctx, args) => {
    trackAccess(ctx.user!, args.track);
    const result = service.prepare(ctx.user!, args.track);
    const audio = result.track.audio;
    return {
      ...result,
      download: audio
        ? tickets.issue({
            objectId: audio.id,
            user: ctx.user!,
            filename: `${result.track.title.replace(/[\x00-\x1f\\/]/g, "_")}.audio`,
            mime: audio.mime,
          })
        : null,
    };
  });
  host.register(contract.media.favorite, (ctx, args) => {
    trackAccess(ctx.user!, args.track);
    service.favorite(ctx.user!, args.track, args.value);
    return { ok: true as const };
  });
  host.register(contract.media.queue, (ctx, args) => {
    enabled(ctx.user!);
    for (const id of args.tracks) trackAccess(ctx.user!, id);
    service.queue(ctx.user!, args.tracks, args);
    return { ok: true as const };
  });
  host.register(contract.media.stopAtEnd, (ctx, args) => {
    enabled(ctx.user!);
    service.setStopAtEnd(ctx.user!, args.value, args);
    return { ok: true as const };
  });
  host.register(contract.media.playlist.create, (ctx, args) => {
    enabled(ctx.user!);
    return { playlist: service.createPlaylist(ctx.user!, args.title) };
  });
  host.register(contract.media.playlist.delete, (ctx, args) => {
    can(ctx.user!, args.playlist, "own");
    service.deletePlaylist(args.playlist);
    return { ok: true as const };
  });
  host.register(contract.media.playlist.items, (ctx, args) => {
    can(ctx.user!, args.playlist, "write");
    args.tracks.forEach((id) => access.require(ctx.user!, id));
    return {
      playlist: service.updatePlaylist(args.playlist, { tracks: args.tracks }),
    };
  });
  host.register(contract.media.retention.set, (ctx, args) => {
    if (args.kind === "track") trackAccess(ctx.user!, args.id);
    else can(ctx.user!, args.id);
    if (!authority.can(ctx.user!, "feature.use", { feature: "offline" }))
      throw new AppError("E_DENIED", "当前账号未获离线授权");
    service.setRetention(ctx.user!, args.kind, args.id, args.value);
    return { ok: true as const };
  });
  host.register(contract.media.recordPlay, (ctx, args) => {
    trackAccess(ctx.user!, args.track);
    service.recordUse(ctx.user!, "track", args.track, args.t.ms);
    return { ok: true as const };
  });
  host.register(contract.media.playlist.recordPlay, (ctx, args) => {
    can(ctx.user!, args.playlist);
    service.recordUse(ctx.user!, "playlist", args.playlist, args.t.ms);
    return { ok: true as const };
  });
  host.register(contract.media.playlist.share, (ctx, args) => {
    const power = sharePower(ctx.user!, args.playlist);
    if (
      power === 0 ||
      (args.level ? { read: 1, write: 2, own: 3 }[args.level] : 3) > power
    )
      throw new AppError("E_DENIED", "没有此歌单的转授权限");
    const playlist = service.playlist(args.playlist);
    if (args.principalType === "user" && args.principal === playlist.owner)
      throw new AppError("E_DENIED", "不能修改原始所有者的访问权");
    if (
      args.principalType === "user"
        ? !authority.repo.actor(args.principal)
        : !community.groups(ctx.user!).includes(args.principal)
    )
      throw new AppError("E_NOT_FOUND", "共享对象不存在或不可见");
    const existing = authority.repo
      .grants(`coll:${args.playlist}`)
      .find(
        (g) =>
          g.principal_type === args.principalType &&
          g.principal === args.principal,
      );
    if (existing && { read: 1, write: 2, own: 3 }[existing.level] > power)
      throw new AppError("E_DENIED", "不能修改更高权限");
    service.options.uow.write(() => {
      authority.setGrant({
        resource: `coll:${args.playlist}`,
        principalType: args.principalType,
        principal: args.principal,
        level: args.level,
      });
    });
    return { ok: true as const };
  });
  host.register(contract.media.playlist.grants, (ctx, args) => {
    can(ctx.user!, args.playlist);
    return {
      grants: authority.repo.grants(`coll:${args.playlist}`).map((g) => ({
        id: g.id,
        principalType: g.principal_type,
        principal: g.principal,
        level: g.level,
      })),
      canShare: sharePower(ctx.user!, args.playlist) > 0,
    };
  });
  host.register(contract.media.playlist.principals, (ctx) => {
    enabled(ctx.user!);
    const ids = new Set([ctx.user!]);
    for (const conv of community.conversations(ctx.user!))
      for (const member of community.visibleMembers(ctx.user!, conv.id).members)
        ids.add(member.user);
    return {
      principals: [
        ...[...ids]
          .map((id) => authority.repo.actor(id))
          .filter((v) => !!v)
          .map((v) => ({ id: v!.id, type: "user" as const, name: v!.name })),
        ...community
          .conversations(ctx.user!)
          .filter((v) => v.kind === "group")
          .map((v) => ({ id: v.id, type: "group" as const, name: v.name })),
      ],
    };
  });
}
