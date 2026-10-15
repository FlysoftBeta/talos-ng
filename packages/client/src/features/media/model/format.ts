import type { MediaPlaylist, MediaTrack } from "@talos/contract";

/** mm:ss for a position or duration in seconds; unknown values read as 00:00. */
export function formatTime(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export const trackHint = (track: MediaTrack): string =>
  `${track.artists.join("、") || "未知艺人"} · ${formatTime(track.durationMs / 1000)}`;
export const artistLine = (track: MediaTrack): string =>
  track.artists.join("、") || "未知艺人";
export const playlistHint = (playlist: MediaPlaylist): string =>
  `${playlist.tracks.length} 首 · 保留 ${playlist.retentionDays} 天`;
/** Server cache states are labelled separately from the bytes held on this device. */
export function cacheLabel(track: MediaTrack, deviceCached: boolean): string {
  return deviceCached ? "本机已缓存" : track.audio ? "服务器已缓存" : "准备中";
}
export const volumePercent = (cap: number): number => Math.round(cap * 100);
/** Share of the track already played, 0..1; unknown length counts as one second. */
export const progressFraction = (position: number, duration: number): number =>
  Math.min(1, position / Math.max(1, duration));
