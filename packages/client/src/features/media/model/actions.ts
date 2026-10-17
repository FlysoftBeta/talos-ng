import { contract } from "@talos/contract";
import type { MediaPlaylist, MediaTrack } from "@talos/contract";
import type {
  RuntimeCommandPort,
  RuntimeFilePort,
  RuntimeNavigationPort,
} from "../../../core/runtime-port.ts";
import type { SharingAdapter } from "../../sharing/index.ts";
import { canEditPlaylist } from "./data.ts";
import type { MediaData } from "./data.ts";

export type MediaCommandPort = Pick<
  RuntimeCommandPort,
  "command" | "operation" | "sync"
> &
  Pick<RuntimeNavigationPort, "dispatch">;
export type MediaTab = "recent" | "favorite" | "playlist" | "search";

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "操作失败，请重试";

// Selectors
/** Tracks listed under a tab; search results are supplied by the caller. */
export function tabTracks(
  tab: MediaTab,
  data: MediaData,
  results: readonly MediaTrack[],
): MediaTrack[] {
  if (tab === "recent")
    return (data.state?.recents ?? [])
      .map((id) => data.tracks.find((t) => t.id === id))
      .filter((t): t is MediaTrack => !!t);
  if (tab === "favorite")
    return data.tracks.filter((t) => data.state?.favorites[t.id]?.v);
  return results.filter((t) => data.tracks.some((known) => known.id === t.id));
}
export const isFavorite = (data: MediaData, track: string): boolean =>
  !!data.state?.favorites[track]?.v;
/** Playlists the user may add this track to. */
export function writablePlaylists(
  data: MediaData,
  track: string,
  user: string | undefined,
): MediaPlaylist[] {
  return data.playlists.filter(
    (p) => !p.tracks.includes(track) && canEditPlaylist(data, p, user),
  );
}
/** A picker always names one accessible playlist or the current search results. */
export function addableTracks(
  data: MediaData,
  playlist: MediaPlaylist,
  source: string,
  results: readonly MediaTrack[],
): MediaTrack[] {
  const ids = new Set(
    data.playlists.find((p) => p.id === source)?.tracks ?? [],
  );
  const candidates =
    source === "search"
      ? tabTracks("search", data, results)
      : data.tracks.filter((t) => ids.has(t.id));
  return candidates.filter((t) => !playlist.tracks.includes(t.id));
}
const playlistPrefix = "playlist:";
export const playlistPageId = (id: string): string => playlistPrefix + id;
export function playlistOfPage(
  data: MediaData,
  page: { kind: string; id?: string } | undefined,
): MediaPlaylist | undefined {
  const id =
    page?.kind === "page" && page.id?.startsWith(playlistPrefix)
      ? page.id.slice(playlistPrefix.length)
      : null;
  return data.playlists.find((p) => p.id === id);
}
export const retentionChoices = (
  days: number | "auto",
): (number | "auto")[] => [
  "auto",
  ...[...new Set([1, 7, 30, 90, 365, ...(days === "auto" ? [] : [days])])].sort(
    (a, b) => a - b,
  ),
];
export const validRetention = (days: number | "auto"): boolean =>
  days === "auto" || (Number.isInteger(days) && days >= 1 && days <= 365);

// Commands
export type SearchKind = "song" | "playlist" | "artist";
export interface OnlineCollection {
  kind: "playlist" | "artist";
  id: string;
  title: string;
  subtitle: string;
}
export interface MediaPage {
  tracks: MediaTrack[];
  collections: OnlineCollection[];
  next: number | null;
}
const PAGE_SIZE = 20;
/** One page of online results for a kind; `offset` is the previous page's `next`. */
export async function searchTracks(
  port: Pick<RuntimeCommandPort, "command">,
  query: string,
  kind: SearchKind = "song",
  offset = 0,
): Promise<MediaPage> {
  const value = await port.command(contract.media.search, {
    query: query.trim(),
    kind,
    offset,
    limit: PAGE_SIZE,
  });
  if ("queued" in value) throw new Error("搜索尚未完成");
  return value;
}
/** One page of the tracks of an online playlist or artist. */
export async function openCollection(
  port: Pick<RuntimeCommandPort, "command">,
  collection: Pick<OnlineCollection, "kind" | "id">,
  offset = 0,
): Promise<MediaPage> {
  const value = await port.command(contract.media.collection, {
    kind: collection.kind,
    id: collection.id,
    offset,
    limit: PAGE_SIZE,
  });
  if ("queued" in value) throw new Error("加载尚未完成");
  return value;
}
export function openPlaylist(
  port: Pick<RuntimeNavigationPort, "dispatch">,
  playlist: MediaPlaylist,
): void {
  port.dispatch({
    type: "pushPage",
    area: "media",
    page: { kind: "page", id: playlistPageId(playlist.id) },
  });
}
/** Creates a playlist and opens it; false while the request is only queued offline. */
export async function createPlaylist(
  port: MediaCommandPort,
  title: string,
): Promise<boolean> {
  const value = await port.command(contract.media.playlist.create, {
    title: title.trim(),
  });
  if ("queued" in value) return false;
  openPlaylist(port, value.playlist);
  return true;
}
export const canCreatePlaylist = (title: string): boolean => !!title.trim();
export async function setFavorite(
  port: MediaCommandPort,
  track: string,
  value: boolean,
): Promise<void> {
  await port.command(contract.media.favorite, {
    track,
    value: { v: value, ...port.operation() },
  });
}
export async function recordPlay(
  port: MediaCommandPort,
  playlist: string,
): Promise<void> {
  await port.command(contract.media.playlist.recordPlay, {
    playlist,
    ...port.operation(),
  });
}
export async function addToPlaylist(
  port: MediaCommandPort,
  playlist: MediaPlaylist,
  track: string,
): Promise<void> {
  await port.command(contract.media.playlist.items, {
    playlist: playlist.id,
    tracks: [...playlist.tracks, track],
  });
  await port.sync();
}
export async function removeFromPlaylist(
  port: MediaCommandPort,
  playlist: MediaPlaylist,
  track: string,
): Promise<void> {
  await port.command(contract.media.playlist.items, {
    playlist: playlist.id,
    tracks: playlist.tracks.filter((id) => id !== track),
  });
}
export async function saveRetention(
  port: MediaCommandPort,
  playlist: string,
  days: number | "auto",
  kind: "track" | "playlist" = "playlist",
): Promise<void> {
  await port.command(contract.media.retention.set, {
    kind,
    id: playlist,
    value: { v: days, ...port.operation() },
  });
}
export async function deletePlaylist(
  port: MediaCommandPort,
  playlist: string,
): Promise<void> {
  await port.command(contract.media.playlist.delete, { playlist });
  port.dispatch({ type: "back" });
}
export function goBack(port: Pick<RuntimeNavigationPort, "dispatch">): void {
  port.dispatch({ type: "back" });
}

/** Sharing commands of one playlist, in the shape the grant sheet consumes. */
export function playlistSharing(
  port: Pick<RuntimeCommandPort, "command">,
  playlist: string,
): SharingAdapter {
  return {
    principals: async () => {
      const v = await port.command(contract.media.playlist.principals, {});
      return "queued" in v ? [] : v.principals;
    },
    list: async () => {
      const v = await port.command(contract.media.playlist.grants, {
        playlist,
      });
      return "queued" in v
        ? { grants: [], canShare: false }
        : { ...v, grants: v.grants.map((g) => ({ ...g, delegate: false })) };
    },
    set: async (value) => {
      await port.command(contract.media.playlist.share, {
        playlist,
        principalType: value.principalType,
        principal: value.principal,
        level: value.level,
      });
    },
  };
}

/** Whether the audio bytes are held on this device; reports to `listener` until cancelled. */
export function watchDeviceCache(
  port: Pick<RuntimeFilePort, "hasFile">,
  audio: string | undefined,
  listener: (cached: boolean) => void,
): () => void {
  let live = true;
  listener(false);
  if (audio)
    void port.hasFile(audio).then((value) => {
      if (live) listener(value);
    });
  return () => {
    live = false;
  };
}

/** Which body the list screen shows for its current tab and request state. */
export type MediaListBody =
  "playlists" | "loading" | "error" | "tracks" | "empty" | "offline";
export function listBody(input: {
  tab: MediaTab;
  busy: boolean;
  error: string;
  tracks: number;
  connection?: string;
}): MediaListBody {
  if (input.tab === "playlist") return "playlists";
  if (input.tab === "search" && input.busy) return "loading";
  if (input.error) return "error";
  if (input.tracks) return "tracks";
  return input.tab === "search"
    ? "empty"
    : emptyState(input.connection ?? "connected");
}
export const emptyTitle = (tab: MediaTab): string =>
  tab === "favorite"
    ? "还没有收藏"
    : tab === "search"
      ? "没有找到曲目"
      : "还没有播放记录";
export const emptyState = (
  connection: string,
): "offline" | "empty" | "loading" =>
  connection === "syncing" || connection === "connecting"
    ? "loading"
    : connection === "offline"
      ? "offline"
      : "empty";
