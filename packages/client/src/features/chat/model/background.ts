import { announcementSchema, contract } from "@talos/contract";
import type { ChatPost } from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
import { StateStore } from "../../../core/controller-state.ts";
import type { BackgroundPort } from "./ports.ts";
import { conversations, states } from "./module.ts";
import { message } from "./commands.ts";
export class BackgroundController extends StateStore<{
  banner: { post: ChatPost; name: string } | undefined;
  error: string;
}> {
  private previous: Map<string, number> | undefined;
  private seen = new Set<string>();
  private timer: unknown;
  private rows: readonly StoredRow[] = [];
  constructor(private runtime: BackgroundPort) {
    super({ banner: undefined, error: "" });
  }
  update(rows: readonly StoredRow[]): void {
    this.rows = rows;
    const runtime = this.runtime,
      snapshot = runtime.getSnapshot(),
      values = states(rows),
      groups = conversations(rows),
      stack = snapshot.nav.areas.chat.stack,
      current = stack[stack.length - 1];
    const next = new Map(
        values.map((value) => [value.conversation, value.lastSeq]),
      ),
      prior = this.previous;
    this.previous = next;
    if (
      !prior ||
      runtime.setting("dnd", false) ||
      runtime.setting("doNotDisturb", false)
    ) {
      this.patch({ banner: undefined });
      return;
    }
    for (const value of values) {
      const post = value.lastPost;
      if (
        !post ||
        this.seen.has(post.id) ||
        value.lastSeq <= (prior.get(value.conversation) ?? value.lastSeq) ||
        value.mute.v ||
        post.author === snapshot.user?.id ||
        post.deletedAt ||
        (snapshot.nav.area === "chat" &&
          current?.kind === "conversation" &&
          current.id === value.conversation)
      )
        continue;
      this.seen.add(post.id);
      if (this.seen.size > 200) this.seen = new Set([...this.seen].slice(-100));
      this.patch({
        banner: {
          post,
          name:
            groups.find((group) => group.id === value.conversation)?.name ??
            "新消息",
        },
      });
      if (this.timer) runtime.clearDelay(this.timer);
      this.timer = runtime.delay(this.dismiss, 4500);
    }
    this.patch({});
  }
  dispose = (): void => {
    if (this.timer) this.runtime.clearDelay(this.timer);
  };
  dismiss = (): void => this.patch({ banner: undefined });
  open = (): void => {
    if (this.state.banner)
      this.runtime.dispatch({
        type: "openConversation",
        id: this.state.banner.post.conversation,
      });
    this.dismiss();
  };
  lock = (): void => this.runtime.lock();
  private announcement() {
    const row = this.rows.find(
        (row) => row.type === "announcement" && !row.deleted,
      ),
      parsed = announcementSchema.safeParse(row?.data);
    const ack = this.rows.find(
      (row) => row.type === "announcementAck" && !row.deleted,
    )?.data as { revision: number } | undefined;
    return parsed.success && parsed.data.revision > (ack?.revision ?? 0)
      ? parsed.data
      : undefined;
  }
  acknowledge = (): void => {
    const announcement = this.announcement();
    if (announcement)
      void this.runtime
        .command(contract.chat.announcement.ack, {
          revision: announcement.revision,
        })
        .catch((cause) => this.patch({ error: message(cause) }));
  };
  presentation() {
    return {
      ...this.state,
      announcement: this.announcement(),
      ackCan: this.runtime.can(contract.chat.announcement.ack),
      preview: this.state.banner
        ? Array.from(this.state.banner.post.preview).slice(0, 60).join("")
        : "",
      dismiss: this.dismiss,
      open: this.open,
      lock: this.lock,
      acknowledge: this.acknowledge,
    };
  }
}
