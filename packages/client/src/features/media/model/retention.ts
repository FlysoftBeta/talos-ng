import { contract } from "@talos/contract";
import type {
  RuntimeClockPort,
  RuntimeCommandPort,
  RuntimeFilePort,
  RuntimeQueryPort,
  RuntimeStatusPort,
} from "../../../core/runtime-port.ts";
import type { MediaData } from "./data.ts";

interface Saved {
  playlist: string;
  track: string;
  rid: string;
  expires: number;
}
export type MediaRetentionPort = Pick<RuntimeCommandPort, "command" | "can"> &
  Pick<RuntimeQueryPort, "getSnapshot"> &
  Pick<
    RuntimeFilePort,
    | "getLocal"
    | "setLocal"
    | "releaseFiles"
    | "collectFiles"
    | "hasFile"
    | "retainFile"
    | "downloadFile"
  > &
  Pick<RuntimeStatusPort, "setDownload"> &
  Pick<RuntimeClockPort, "time">;
export interface MediaRetentionInput {
  user: string | undefined;
  /** Unlocked application. */
  active: boolean;
  offline: boolean;
  data: MediaData;
}
const expiry = (p: MediaData["playlists"][number]): number =>
  Math.max(p.lastPlayed, p.created) + p.retentionDays * 86400000;
/** Changes when a playlist, its members or their audio change; effect key for callers. */
export function mediaRetentionSignature(data: MediaData): string {
  return JSON.stringify(
    data.playlists.map((p) => [
      p.id,
      p.tracks,
      p.retentionDays,
      p.lastPlayed,
      data.tracks.map((t) => t.audio?.id),
    ]),
  );
}

/**
 * Keeps the audio of retained playlists downloaded and releases expired or removed
 * members. FileStore owners are per user, playlist and track; runs are serialised and
 * every step re-checks that the account has not changed.
 */
export class MediaRetentionScheduler {
  private queue: Promise<void> = Promise.resolve();
  private cancel: (() => void) | undefined;
  constructor(private readonly port: MediaRetentionPort) {}
  update(input: MediaRetentionInput): void {
    this.stop();
    if (!input.user || !input.active) return;
    const { port } = this,
      { user, data } = input;
    let cancelled = false;
    const active = (): boolean =>
      !cancelled && port.getSnapshot().user?.id === user;
    const run = async () => {
      const saved = (await port.getLocal<Saved[]>("media:retained")) ?? [];
      const retained: Saved[] = [];
      for (const item of saved) {
        const p = data.playlists.find((v) => v.id === item.playlist);
        const expires = p ? expiry(p) : 0;
        if (expires <= port.time() || !p?.tracks.includes(item.track)) {
          await port.releaseFiles(`coll:${item.playlist}:media:${item.track}`);
        } else retained.push({ ...item, expires });
      }
      if (!active()) return;
      await port.setLocal("media:retained", retained);
      await port.collectFiles();
      if (input.offline) return;
      for (const p of data.playlists) {
        const expires = expiry(p);
        if (expires <= port.time()) continue;
        for (const id of p.tracks) {
          if (!active()) return;
          let track = data.tracks.find((t) => t.id === id);
          if (!track) continue;
          const key = `coll:${p.id}:media:${id}`;
          if (track.audio && (await port.hasFile(track.audio.id))) {
            await port.retainFile(track.audio.id, key);
            if (!retained.some((i) => i.playlist === p.id && i.track === id))
              retained.push({
                playlist: p.id,
                track: id,
                rid: track.audio.id,
                expires,
              });
            await port.setLocal("media:retained", retained.slice());
            continue;
          }
          try {
            if (!port.can(contract.media.prepare).ok) continue;
            const prepared = await port.command(contract.media.prepare, {
              track: id,
            });
            if ("queued" in prepared) continue;
            if (!prepared.download) continue;
            track = prepared.track;
            if (!track.audio) continue;
            const title = track.title;
            port.setDownload(key, { title, progress: 0 });
            await port.downloadFile(
              track.audio.id,
              track.audio.size,
              prepared.download.url,
              key,
              (written, total) =>
                port.setDownload(key, {
                  title,
                  progress: total ? written / total : 1,
                }),
            );
            if (!active()) {
              await port.releaseFiles(key);
              await port.collectFiles();
              port.setDownload(key, undefined);
              return;
            }
            retained.push({
              playlist: p.id,
              track: id,
              rid: track.audio.id,
              expires,
            });
            await port.setLocal("media:retained", retained.slice());
            port.setDownload(key, undefined);
          } catch (error) {
            port.setDownload(key, {
              title: track.title,
              progress: 0,
              error: error instanceof Error ? error.message : "音频下载失败",
            });
          }
        }
      }
    };
    this.queue = this.queue.then(run).catch(() => {});
    this.cancel = () => {
      cancelled = true;
    };
  }
  /** Cancels the current pass; steps already started finish but publish nothing further. */
  stop(): void {
    this.cancel?.();
    this.cancel = undefined;
  }
  /** Resolves when every started pass has settled. */
  idle(): Promise<void> {
    return this.queue;
  }
}
