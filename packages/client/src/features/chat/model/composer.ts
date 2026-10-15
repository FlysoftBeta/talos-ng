import { CHAT_MAX_TEXT, contract } from "@talos/contract";
import type {
  ChatState,
  CommunityConversation,
  ChatSticker,
} from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { ComposerPort, ImageSource } from "./ports.ts";
import type { PostView } from "./module.ts";
import { draftBody, message, sendText, setState } from "./commands.ts";
import { uploadImage } from "./upload.ts";
export interface ComposerInput {
  group: CommunityConversation;
  state: ChatState;
  reply?: PostView;
  onReplyClear(): void;
}
export class ComposerController extends StateStore<{
  text: string;
  fullscreen: boolean;
  stickers: boolean;
  images: boolean;
  error: string;
  busy: boolean;
  progress: number | undefined;
  now: number;
}> {
  private saved: string;
  private saving: string | undefined;
  private writeVersion = 0;
  private draftVersion = 0;
  private timer: unknown;
  private muteTimer: unknown;
  private active = true;
  private draftKey = "";
  constructor(
    private runtime: ComposerPort,
    private input: ComposerInput,
  ) {
    super({
      text: input.state.draft.v,
      fullscreen: false,
      stickers: false,
      images: false,
      error: "",
      busy: false,
      progress: undefined,
      now: runtime.time(),
    });
    this.saved = input.state.draft.v;
  }
  update(input: ComposerInput): void {
    this.input = input;
    const state = input.state;
    const key = `${state.draft.op}:${state.draftTextId}`;
    if (key !== this.draftKey) {
      this.draftKey = key;
      const version = ++this.draftVersion;
      if (this.state.text === this.saved && !state.draftTextId) {
        this.saved = state.draft.v;
        this.patch({ text: state.draft.v });
      }
      if (state.draftTextId)
        void draftBody(this.runtime, state.draftTextId)
          .then((value) => {
            if (
              this.active &&
              version === this.draftVersion &&
              value !== undefined &&
              this.state.text === state.draft.v
            ) {
              this.saved = value;
              this.patch({ text: value });
            }
          })
          .catch((cause) => this.patch({ error: message(cause) }));
    }
    this.scheduleMute();
    this.patch({});
  }
  private scheduleMute(): void {
    if (this.muteTimer) this.runtime.clearDelay(this.muteTimer);
    const remaining = this.input.state.mutedUntil - this.runtime.time();
    if (remaining > 0)
      this.muteTimer = this.runtime.delay(
        () => {
          this.patch({ now: this.runtime.time() });
          this.scheduleMute();
        },
        Math.min(remaining, 2_147_483_647),
      );
  }
  start = (): (() => void) => {
    this.active = true;
    this.update(this.input);
    return () => this.dispose();
  };
  dispose(): void {
    this.active = false;
    ++this.draftVersion;
    if (this.timer) this.runtime.clearDelay(this.timer);
    if (this.muteTimer) this.runtime.clearDelay(this.muteTimer);
    if (this.state.text !== this.saved)
      void setState(
        this.runtime,
        this.input.group.id,
        "draft",
        this.state.text,
      ).catch(() => undefined);
  }
  persist = (value = this.state.text, force = false): void => {
    if (!force && (value === this.saved || value === this.saving)) return;
    const version = ++this.writeVersion;
    this.saving = value;
    void setState(this.runtime, this.input.group.id, "draft", value)
      .then(() => {
        if (version === this.writeVersion) this.saved = value;
      })
      .catch((cause) => this.patch({ error: message(cause) }))
      .finally(() => {
        if (version === this.writeVersion) this.saving = undefined;
      });
  };
  change = (text: string): void => {
    this.patch({ text, error: "" });
    if (this.timer) this.runtime.clearDelay(this.timer);
    this.timer = this.runtime.delay(() => this.persist(text), 400);
  };
  private clear(): void {
    if (this.timer) this.runtime.clearDelay(this.timer);
    this.patch({ text: "" });
    this.persist("", true);
    this.input.onReplyClear();
  }
  restriction(): string | undefined {
    const { group, state } = this.input,
      snapshot = this.runtime.getSnapshot(),
      can = this.runtime.can(contract.chat.post.send);
    return state.mutedUntil > Math.max(this.state.now, this.runtime.time())
      ? `禁言至 ${new Date(state.mutedUntil).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
      : group.adminOnly &&
          group.owner !== snapshot.user?.id &&
          !snapshot.user?.roles.includes("community_manager") &&
          !snapshot.user?.roles.includes("root")
        ? "本群仅管理员可发言"
        : !can.ok
          ? can.reason
          : undefined;
  }
  send = async (): Promise<void> => {
    if (this.state.busy || this.restriction() || !this.state.text.trim())
      return;
    this.patch({ busy: true, error: "" });
    try {
      await sendText(
        this.runtime,
        this.input.group.id,
        this.state.text,
        this.input.reply?.id,
      );
      this.clear();
      this.patch({ fullscreen: false });
    } catch (cause) {
      this.patch({ error: message(cause) });
    } finally {
      this.patch({ busy: false });
    }
  };
  image = async (file: ImageSource): Promise<void> => {
    this.patch({ busy: true, progress: 0 });
    try {
      await uploadImage(
        this.runtime,
        this.input.group.id,
        file,
        (progress) => this.patch({ progress }),
        this.input.reply?.id,
      );
      this.input.onReplyClear();
      this.patch({ images: false });
    } catch (cause) {
      this.patch({ error: message(cause) });
    } finally {
      this.patch({ busy: false, progress: undefined });
    }
  };
  pick = async (sticker: ChatSticker): Promise<void> => {
    const { op } = this.runtime.operation(),
      { group, reply } = this.input;
    await this.runtime.command(
      contract.chat.post.send,
      {
        id: op,
        conversation: group.id,
        kind: "sticker",
        sticker: sticker.id,
        ...(reply ? { replyTo: reply.id } : {}),
      },
      { op },
    );
    this.input.onReplyClear();
  };
  setFullscreen = (fullscreen: boolean): void => this.patch({ fullscreen });
  setStickers = (stickers: boolean): void => this.patch({ stickers });
  setImages = (images: boolean): void => this.patch({ images });
  presentation() {
    const restricted = this.restriction(),
      imageGate = this.runtime.gate("post_images"),
      imageCan = this.runtime.can(contract.chat.post.image);
    return {
      ...this.state,
      ...this.input,
      restricted,
      imageReason: !imageGate.ok
        ? imageGate.reason
        : !imageCan.ok
          ? imageCan.reason
          : "",
      imageAllowed: imageGate.ok && imageCan.ok && !restricted,
      sendDisabled: this.state.busy || !!restricted || !this.state.text.trim(),
      maxText: CHAT_MAX_TEXT,
      fullscreenSendDisabled: this.state.busy || !this.state.text.trim(),
      showCount: this.state.text.length > CHAT_MAX_TEXT * 0.8,
      textCount: this.state.text.length.toLocaleString(),
      maxTextCount: CHAT_MAX_TEXT.toLocaleString(),
      progressLabel:
        this.state.progress === undefined
          ? ""
          : Math.round(this.state.progress * 100),
      replyLabel: this.input.reply
        ? `${this.input.reply.authorName}：${this.input.reply.preview.slice(0, 80)}`
        : "",

      change: this.change,
      persist: this.persist,
      send: this.send,
      image: this.image,
      pick: this.pick,
      setFullscreen: this.setFullscreen,
      setStickers: this.setStickers,
      setImages: this.setImages,
    };
  }
}
