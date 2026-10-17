import type { ChatState, CommunityConversation } from "@talos/contract";
import { contract } from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
import type { RetentionPort } from "./ports.ts";
import { fileBytes, fullBody, message, page } from "./commands.ts";
/** A rolling sent-time window; choosing a policy does not start an expiry lease. */
export function retentionCutoff(
  policy: "auto" | "week" | "half-year",
  now: number,
): number | undefined {
  return policy === "auto"
    ? undefined
    : Math.max(0, now - (policy === "week" ? 7 : 183) * 86400000);
}

export class RetentionController {
  private running = new Set<string>();
  private completed = new Map<string, string>();
  private failed = new Map<string, string>();
  private released = new Set<string>();
  private policies: readonly ChatState[] = [];
  private groups: readonly CommunityConversation[] = [];
  private rows: readonly StoredRow[] = [];
  private timer: unknown;
  private timerKey = "";
  private disposed = false;
  constructor(private runtime: RetentionPort) {}
  update(
    states: readonly ChatState[],
    groups: readonly CommunityConversation[],
    rows: readonly StoredRow[],
  ): void {
    this.disposed = false;
    this.policies = states;
    this.groups = groups;
    this.rows = rows;
    const key = states.map((state) => state.retention.op).join(":");
    if (key !== this.timerKey) {
      this.timerKey = key;
      this.schedule();
    }
    this.run();
  }
  private schedule(): void {
    if (this.timer) this.runtime.clearDelay(this.timer);
    if (this.policies.some((state) => state.retention.v !== "auto"))
      this.timer = this.runtime.delay(() => {
        this.completed.clear();
        this.run();
        this.schedule();
      }, 3600000);
  }
  dispose = (): void => {
    this.disposed = true;
    this.timerKey = "";
    if (this.timer) this.runtime.clearDelay(this.timer);
  };
  private run(): void {
    const runtime = this.runtime,
      states = this.policies,
      groups = this.groups,
      rows = this.rows,
      snapshot = runtime.getSnapshot();
    if (snapshot.status.connection !== "connected") this.failed.clear();
    for (const state of states) {
      const id = `conv:${state.conversation}:retained`;
      const cutoff = retentionCutoff(state.retention.v, runtime.time());
      const releaseKey = `${snapshot.user?.id}:${state.conversation}:${state.retention.op}`;
      if (cutoff === undefined) {
        if (!this.released.has(releaseKey)) {
          this.released.add(releaseKey);
          runtime.setTransfer(id, undefined);
          void runtime
            .releaseFiles(id)
            .catch(() => this.released.delete(releaseKey));
        }
        continue;
      }
      if (
        snapshot.gate !== "app" ||
        !runtime.hasScope(`conv:${state.conversation}`) ||
        !runtime.can(contract.chat.post.page).ok
      )
        continue;
      const revision = rows.reduce(
        (latest, row) =>
          row.scope === `conv:${state.conversation}` && row.type === "post"
            ? Math.max(latest, row.rev)
            : latest,
        state.lastPost?.rev ?? 0,
      );
      const key = `${snapshot.user?.id}:${state.retention.op}:${state.lastSeq}:${revision}`;
      if (
        this.running.has(id) ||
        this.completed.get(id) === key ||
        this.failed.get(id) === key
      )
        continue;
      this.running.add(id);
      const owner = snapshot.user?.id;
      const active = (): boolean =>
        !this.disposed &&
        runtime.getSnapshot().user?.id === owner &&
        runtime.getSnapshot().gate === "app" &&
        runtime.hasScope(`conv:${state.conversation}`) &&
        this.policies.some(
          (value) =>
            value.conversation === state.conversation &&
            value.retention.op === state.retention.op,
        );
      const name =
        groups.find((group) => group.id === state.conversation)?.name ?? "对话";
      void (async () => {
        if (!active()) return;
        await runtime.releaseFiles(id);
        await runtime.setLocal(`conv:${state.conversation}:retention`, {
          op: state.retention.op,
          cutoff,
        });
        let anchor: number | undefined;
        let count = 0;
        runtime.setTransfer(id, { title: `离线保留 · ${name}`, progress: 0 });
        for (;;) {
          if (!active()) return;
          const result = await page(
            runtime,
            state.conversation,
            anchor === undefined ? "latest" : "before",
            anchor,
          );
          for (const post of result.posts) {
            if (!active()) return;
            if (post.created < cutoff) continue;
            if (!post.deletedAt) {
              if (post.kind === "text") await fullBody(runtime, post);
              if (post.image) {
                await fileBytes(
                  runtime,
                  post.image.thumbnail,
                  state.conversation,
                  id,
                );
                await fileBytes(
                  runtime,
                  post.image.original,
                  state.conversation,
                  id,
                );
              }
              if (post.sticker)
                await fileBytes(runtime, post.sticker.file, undefined, id);
            }
            count++;
          }
          runtime.setTransfer(id, {
            title: `离线保留 · ${name} · ${count} 条`,
            progress: Math.min(1, count / Math.max(1, result.latest)),
          });
          if (
            !result.hasBefore ||
            !result.first ||
            result.posts.some((post) => post.created < cutoff) ||
            (anchor !== undefined && result.first >= anchor)
          )
            break;
          anchor = result.first;
        }
        if (!active()) return;
        this.completed.set(id, key);
        runtime.setTransfer(id, {
          title: `离线保留完成 · ${name} · ${count} 条`,
          progress: 1,
        });
      })()
        .catch((cause) => {
          this.failed.set(id, key);
          if (active())
            runtime.setTransfer(id, {
              title: `离线保留 · ${name}`,
              progress: 0,
              error: message(cause),
            });
        })
        .finally(() => {
          this.running.delete(id);
          if (!this.disposed) this.run();
        });
    }
  }
}
