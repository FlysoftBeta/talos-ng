import { contract } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { PostView } from "./module.ts";
import type {
  RuntimeQueryPort,
  RuntimeCommandPort,
  RuntimeFilePort,
} from "../../../core/runtime-port.ts";
export class PostCardController extends StateStore<{
  localBody: string | undefined;
}> {
  private generation = 0;
  constructor(
    private runtime: Pick<RuntimeQueryPort, "getSnapshot"> &
      Pick<RuntimeCommandPort, "can"> &
      Pick<RuntimeFilePort, "getLocal">,
    private copy: (text: string) => void,
  ) {
    super({ localBody: undefined });
  }
  update(post: PostView): void {
    const generation = ++this.generation;
    this.patch({ localBody: undefined });
    if ((post.pending || post.failed) && post.kind === "text")
      void this.runtime
        .getLocal<string>(`body:${post.id}`)
        .then((localBody) => {
          if (generation === this.generation) this.patch({ localBody });
        })
        .catch(() => undefined);
  }
  dispose = (): void => {
    ++this.generation;
  };
  presentation(post: PostView, reply?: PostView) {
    const user = this.runtime.getSnapshot().user,
      own = post.author === user?.id;
    const preview =
      post.pending || post.failed
        ? (this.state.localBody ?? post.preview)
        : post.preview;
    const bodyLength =
      post.pending || post.failed
        ? (this.state.localBody?.length ?? post.bodyLength)
        : post.bodyLength;
    return {
      own,
      textPreview: preview.slice(0, 500),
      bodyLengthLabel: bodyLength.toLocaleString(),
      replyLabel: reply
        ? `${reply.authorName}：${reply.deletedAt ? "消息已删除" : reply.preview.slice(0, 80)}`
        : "查看引用的消息",

      preview,
      bodyLength:
        post.pending || post.failed
          ? (this.state.localBody?.length ?? post.bodyLength)
          : post.bodyLength,
      edit: this.runtime.can(contract.chat.post.edit),
      editable: own && post.kind === "text" && !post.pending && !post.failed,
      deletable:
        !!(
          own ||
          user?.roles.includes("community_manager") ||
          user?.roles.includes("root")
        ) &&
        !post.pending &&
        !post.failed,
      createdLabel: post.created
        ? new Date(post.created).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "正在发送",
      deletedLabel: post.deletedAt
        ? new Date(post.deletedAt).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
          })
        : "",
      onCopy: () => this.copy(preview),
    };
  }
}
