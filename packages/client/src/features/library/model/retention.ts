import { contract } from "@talos/contract";
import type {
  RuntimeClockPort,
  RuntimeFilePort,
  RuntimeStatusPort,
} from "../../../core/runtime-port.ts";
import { describeDocument, documentKey } from "./documents.ts";
import type { DocumentReadPort } from "./documents.ts";
import type { LibraryData } from "./library-data.ts";
interface Saved {
  doc: string;
  rid: string;
  expires: number;
}
export type RetentionPort = DocumentReadPort &
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
  Pick<RuntimeStatusPort, "setTransfer"> &
  Pick<RuntimeClockPort, "time" | "delay" | "clearDelay">;
export interface RetentionInput {
  user: string | undefined;
  active: boolean;
  offline?: boolean;
  /** Missing rows during recovery are not evidence that retention was removed. */
  syncing?: boolean;
  data: LibraryData;
}
/** A member is kept until the latest personal item or containing-list deadline. */
export function retentionDeadline(data: LibraryData, id: string): number {
  if (!data.docs.some((item) => item.id === id)) return 0;
  let deadline = 0;
  for (const policy of data.retentions.values()) {
    if (!policy.value || typeof policy.value.v !== "number") continue;
    if (
      policy.kind === "doc"
        ? policy.id !== id
        : !data.collections.some(
            (list) => list.id === policy.id && list.docs.includes(id),
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
export function retentionSignature(data: LibraryData): string {
  return JSON.stringify([
    data.docs.map((item) => [item.id, item.pack?.id]),
    data.collections.map((list) => [list.id, list.docs]),
    [...data.retentions.values()],
  ]);
}
/** Serialized passes never perform cleanup or publish progress for a replaced account. */
export class RetentionScheduler {
  private queue: Promise<void> = Promise.resolve();
  private cancel: (() => void) | undefined;
  constructor(private readonly port: RetentionPort) {}
  update(input: RetentionInput): void {
    this.stop();
    if (!input.user || !input.active || input.syncing) return;
    const { port } = this,
      { user, data } = input;
    let cancelled = false,
      failed = false;
    let timer: ReturnType<RetentionPort["delay"]> | undefined;
    const active = () => !cancelled && port.getSnapshot().user?.id === user;
    const publish: RetentionPort["setTransfer"] = (id, value) => {
      if (active()) port.setTransfer(id, value);
    };
    const owner = (id: string) => `library:${id}:retained`;
    const allowed = (id: string) => retentionDeadline(data, id);
    const run = async () => {
      if (!active()) return;
      const saved = (await port.getLocal<Saved[]>("library:retained")) ?? [];
      if (!active()) return;
      const retained: Saved[] = [];
      for (const item of saved) {
        if (!active()) return;
        const expires = allowed(item.doc);
        if (
          expires <= port.time() ||
          (data.docs.find((value) => value.id === item.doc)?.pack?.id &&
            data.docs.find((value) => value.id === item.doc)?.pack?.id !==
              item.rid)
        ) {
          await port.releaseFiles(owner(item.doc));
          if (!active()) return;
          publish(`library:${item.doc}`, undefined);
          if (!data.docs.some((doc) => doc.id === item.doc))
            await port.setLocal(documentKey(item.doc), null);
        } else retained.push({ ...item, expires });
      }
      if (!active()) return;
      await port.setLocal("library:retained", retained);
      if (!active()) return;
      await port.collectFiles();
      if (!active()) return;
      for (const item of data.docs) {
        if (!active()) return;
        const id = item.id,
          expires = allowed(id),
          key = owner(id),
          status = `library:${id}`;
        if (expires <= port.time() || item.status !== "ready" || !item.pack)
          continue;
        try {
          const cached = item.pack && (await port.hasFile(item.pack.id));
          if (!active()) return;
          let resource = item.pack,
            url: string | undefined;
          if (!cached) {
            if (input.offline || !port.can(contract.library.doc.open).ok)
              continue;
            const opened = await describeDocument(port, id);
            if (!active()) return;
            resource = opened.pack;
            url = opened.download.url;
            await port.setLocal(documentKey(id), opened);
            if (!active()) return;
          }
          if (!resource || allowed(id) <= port.time()) continue;
          const entry = { doc: id, rid: resource.id, expires };
          const previous = retained.findIndex((value) => value.doc === id);
          if (previous < 0) retained.push(entry);
          else retained[previous] = entry;
          // Persist before downloading so a replacement policy pass can release partial bytes.
          await port.setLocal("library:retained", retained.slice());
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
        publish("library:retention", {
          title: "离线文档",
          progress: 0,
          error: error instanceof Error ? error.message : "离线保留失败",
        });
      })
      .then(() => {
        if (!active()) return;
        if (!failed) publish("library:retention", undefined);
        const deadlines = data.docs
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
