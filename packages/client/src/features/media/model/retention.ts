import { contract } from "@talos/contract";
import type {
  RuntimeClockPort,
  RuntimeCommandPort,
  RuntimeQueryPort,
  RuntimeFilePort,
  RuntimeStatusPort,
} from "../../../core/runtime-port.ts";
import type { MediaData } from "./data.ts";
interface Saved {
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
  Pick<RuntimeClockPort, "time" | "delay" | "clearDelay">;
export interface MediaRetentionInput {
  user: string | undefined;
  active: boolean;
  offline?: boolean;
  /** Missing rows during recovery are not evidence that retention was removed. */
  syncing?: boolean;
  data: MediaData;
}
/** A member is kept until the latest personal item or containing-list deadline. */
export function retentionDeadline(data: MediaData, id: string): number {
  if (!data.tracks.some((item) => item.id === id)) return 0;
  let deadline = 0;
  for (const policy of data.retentions.values()) {
    if (!policy.value || typeof policy.value.v !== "number") continue;
    if (
      policy.kind === "track"
        ? policy.id !== id
        : !data.playlists.some(
            (list) => list.id === policy.id && list.tracks.includes(id),
          )
    )
      continue;
    deadline = Math.max(
      deadline,
      Math.max(policy.value.t.ms, policy.lastUsed) + policy.value.v * 86400000,
    );
  }
  return deadline;
}
export function mediaRetentionSignature(data: MediaData): string {
  return JSON.stringify([
    data.tracks.map((item) => [item.id, item.audio?.id]),
    data.playlists.map((list) => [list.id, list.tracks]),
    [...data.retentions.values()],
  ]);
}
/** Serialized passes never perform cleanup or publish progress for a replaced account. */
export class MediaRetentionScheduler {
  private queue: Promise<void> = Promise.resolve();
  private cancel: (() => void) | undefined;
  constructor(private readonly port: MediaRetentionPort) {}
  update(input: MediaRetentionInput): void {
    this.stop();
    if (!input.user || !input.active || input.syncing) return;
    const { port } = this,
      { user, data } = input;
    let cancelled = false,
      failed = false;
    let timer: ReturnType<MediaRetentionPort["delay"]> | undefined;
    const active = () => !cancelled && port.getSnapshot().user?.id === user;
    const publish: MediaRetentionPort["setDownload"] = (id, value) => {
      if (active()) port.setDownload(id, value);
    };
    const owner = (id: string) => `media:${id}:retained`;
    const allowed = (id: string) => retentionDeadline(data, id);
    const run = async () => {
      if (!active()) return;
      const saved = (await port.getLocal<Saved[]>("media:retained")) ?? [];
      if (!active()) return;
      const retained: Saved[] = [];
      for (const item of saved) {
        if (!active()) return;
        const expires = allowed(item.track);
        if (
          expires <= port.time() ||
          (data.tracks.find((value) => value.id === item.track)?.audio?.id &&
            data.tracks.find((value) => value.id === item.track)?.audio?.id !==
              item.rid)
        ) {
          await port.releaseFiles(owner(item.track));
          if (!active()) return;
          publish(`media:${item.track}`, undefined);
        } else retained.push({ ...item, expires });
      }
      if (!active()) return;
      await port.setLocal("media:retained", retained);
      if (!active()) return;
      await port.collectFiles();
      if (!active()) return;
      for (const item of data.tracks) {
        if (!active()) return;
        const id = item.id,
          expires = allowed(id),
          key = owner(id),
          status = `media:${id}`;
        if (expires <= port.time()) continue;
        try {
          const cached = item.audio && (await port.hasFile(item.audio.id));
          if (!active()) return;
          let resource = item.audio,
            url: string | undefined;
          if (!cached) {
            if (input.offline || !port.can(contract.media.prepare).ok) continue;
            const opened = await port.command(contract.media.prepare, {
              track: id,
            });
            if (!active()) return;
            if ("queued" in opened || !opened.download || !opened.track.audio)
              continue;
            resource = opened.track.audio;
            url = opened.download.url;
            if (!active()) return;
          }
          if (!resource || allowed(id) <= port.time()) continue;
          const entry = { track: id, rid: resource.id, expires };
          const previous = retained.findIndex((value) => value.track === id);
          if (previous < 0) retained.push(entry);
          else retained[previous] = entry;
          // Persist before downloading so a replacement policy pass can release partial bytes.
          await port.setLocal("media:retained", retained.slice());
          if (!active()) return;
          if (cached) await port.retainFile(resource.id, key);
          else {
            publish(status, { title: item.title, progress: 0 });
            await port.downloadFile(
              resource.id,
              resource.size,
              url!,
              key,
              (written, total) =>
                publish(status, {
                  title: item.title,
                  progress: total ? written / total : 1,
                }),
            );
          }
          if (!active()) return;
          if (allowed(id) <= port.time()) {
            await port.releaseFiles(key);
            if (!active()) return;
            await port.collectFiles();
          }
          publish(status, undefined);
        } catch (error) {
          failed = true;
          publish(status, {
            title: item.title,
            progress: 0,
            error: error instanceof Error ? error.message : "离线下载失败",
          });
        }
      }
    };
    this.queue = this.queue
      .then(run)
      .catch((error: unknown) => {
        failed = true;
        publish("media:retention", {
          title: "离线音乐",
          progress: 0,
          error: error instanceof Error ? error.message : "离线保留失败",
        });
      })
      .then(() => {
        if (!active()) return;
        if (!failed) publish("media:retention", undefined);
        const deadlines = data.tracks
          .map((item) => allowed(item.id))
          .filter((time) => time > port.time());
        if (failed) deadlines.push(port.time() + 30000);
        if (deadlines.length)
          timer = port.delay(
            () => this.update(input),
            Math.min(
              2147483647,
              Math.max(1, Math.min(...deadlines) - port.time()),
            ),
          );
      });
    this.cancel = () => {
      cancelled = true;
      port.clearDelay(timer);
    };
  }
  stop(): void {
    this.cancel?.();
    this.cancel = undefined;
  }
  idle(): Promise<void> {
    return this.queue;
  }
}
