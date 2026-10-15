import { contract } from "@talos/contract";
import type {
  RuntimeClockPort,
  RuntimeFilePort,
  RuntimeStatusPort,
} from "../../../core/runtime-port.ts";
import { describeDocument, documentKey } from "./documents.ts";
import type { DocumentReadPort } from "./documents.ts";
import type { LibraryData } from "./library-data.ts";

interface RetainedDocument {
  doc: string;
  pack: string;
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
    | "downloadFile"
  > &
  Pick<RuntimeStatusPort, "setDownload"> &
  Pick<RuntimeClockPort, "time" | "delay" | "clearDelay">;
export interface RetentionInput {
  /** Signed-in account, if any. */
  user: string | undefined;
  /** True while the application is unlocked and may transfer data. */
  active: boolean;
  data: LibraryData;
}
/** Changes when a document, its pack or its retention policy changes; effect key for callers. */
export function retentionSignature(data: LibraryData): string {
  return JSON.stringify(
    data.docs.map((doc) => [
      doc.id,
      doc.pack?.id,
      data.states.get(doc.id)?.retention,
    ]),
  );
}

/**
 * Keeps retained document packs downloaded and releases expired ones. Runs outside the
 * reader so retained downloads resume after an offline restart; runs are serialised and
 * every step re-checks that the account has not changed.
 */
export class RetentionScheduler {
  private queue: Promise<void> = Promise.resolve();
  private stopCurrent: (() => void) | undefined;
  constructor(private readonly port: RetentionPort) {}
  /** Starts a new pass for the given state, cancelling the previous one and its expiry timer. */
  update(input: RetentionInput): void {
    this.stop();
    const { port } = this;
    const { user, data } = input;
    let cancelled = false;
    const sameUser = (): boolean =>
      !!user && port.getSnapshot().user?.id === user;
    const publish: RetentionPort["setDownload"] = (id, value) => {
      if (sameUser()) port.setDownload(id, value);
    };
    const allowed = (id: string): number => {
      const policy = data.states.get(id)?.retention;
      return policy &&
        policy.v !== "auto" &&
        data.docs.some((doc) => doc.id === id)
        ? policy.t.ms + policy.v * 86400000
        : 0;
    };
    const run = async () => {
      if (cancelled || !sameUser()) return;
      const saved =
        (await port.getLocal<RetainedDocument[]>("library:retained")) ?? [];
      const keep: RetainedDocument[] = [];
      for (const item of saved) {
        if (!sameUser()) return;
        const expires = allowed(item.doc);
        if (expires <= port.time()) {
          await port.releaseFiles(`library:${item.doc}:retained`);
          if (!sameUser()) return;
          if (!data.docs.some((doc) => doc.id === item.doc))
            await port.setLocal(documentKey(item.doc), null);
        } else keep.push({ ...item, expires });
      }
      if (!sameUser()) return;
      await port.setLocal("library:retained", keep);
      if (!sameUser()) return;
      await port.collectFiles();
      for (const doc of data.docs) {
        if (cancelled || !sameUser()) break;
        const policy = data.states.get(doc.id)?.retention;
        if (
          !policy ||
          policy.v === "auto" ||
          !doc.pack ||
          doc.status !== "ready"
        )
          continue;
        const expires = policy.t.ms + policy.v * 86400000;
        if (expires <= port.time()) continue;
        if (await port.hasFile(doc.pack.id)) continue;
        if (!sameUser()) return;
        if (!port.can(contract.library.doc.open).ok) continue;
        const id = `library:${doc.id}`;
        try {
          const opened = await describeDocument(port, doc.id);
          if (!sameUser()) return;
          if (allowed(doc.id) <= port.time()) continue;
          await port.setLocal(documentKey(doc.id), opened);
          if (!sameUser()) return;
          // Register incomplete ownership too, so expiry/revocation can release it.
          const entry = { doc: doc.id, pack: opened.pack.id, expires };
          const index = keep.findIndex((item) => item.doc === doc.id);
          if (index < 0) keep.push(entry);
          else keep[index] = entry;
          await port.setLocal("library:retained", keep.slice());
          if (!sameUser()) return;
          publish(id, { title: doc.title, progress: 0 });
          await port.downloadFile(
            opened.pack.id,
            opened.pack.size,
            opened.download.url,
            `library:${doc.id}:retained`,
            (written, total) =>
              publish(id, {
                title: doc.title,
                progress: total ? written / total : 1,
              }),
          );
          if (!sameUser()) return;
          if (allowed(doc.id) <= port.time()) {
            await port.releaseFiles(`library:${doc.id}:retained`);
            if (!sameUser()) return;
            if (!data.docs.some((value) => value.id === doc.id))
              await port.setLocal(documentKey(doc.id), null);
          }
          publish(id, undefined);
        } catch (error) {
          publish(id, {
            title: doc.title,
            progress: 0,
            error:
              error instanceof Error
                ? error.message
                : "下载失败，重新连接后继续",
          });
        }
      }
    };
    if (input.user && input.active)
      this.queue = this.queue.then(run).catch((error: unknown) => {
        publish("library:retention", {
          title: "离线文档",
          progress: 0,
          error: error instanceof Error ? error.message : "离线保留失败",
        });
      });
    const deadlines = data.docs
      .map((doc) => allowed(doc.id))
      .filter((time) => time > port.time());
    const timer = deadlines.length
      ? port.delay(
          () => this.update(input),
          Math.min(
            2147483647,
            Math.max(1, Math.min(...deadlines) - port.time()),
          ),
        )
      : undefined;
    this.stopCurrent = () => {
      cancelled = true;
      port.clearDelay(timer);
    };
  }
  /** Cancels the current pass and its expiry timer. */
  stop(): void {
    this.stopCurrent?.();
    this.stopCurrent = undefined;
  }
}
