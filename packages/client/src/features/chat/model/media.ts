import { contract } from "@talos/contract";
import type { ChatFile, ChatSticker } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { MediaPort } from "./ports.ts";
import { fileBytes, message, onlineCall } from "./commands.ts";
export interface ImageUrls {
  create(bytes: Uint8Array, mime: string): string;
  release(url: string): void;
}
export class CachedImageController extends StateStore<{
  src: string;
  error: string;
}> {
  private generation = 0;
  constructor(
    private runtime: MediaPort,
    private urls: ImageUrls,
    private file: ChatFile,
    private conversation?: string,
  ) {
    super({ src: "", error: "" });
  }
  load = (): void => {
    this.dispose();
    const generation = this.generation;
    this.patch({ src: "", error: "" });
    void fileBytes(this.runtime, this.file, this.conversation)
      .then((bytes) => {
        if (generation !== this.generation) return;
        this.patch({ src: this.urls.create(bytes, this.file.mime) });
      })
      .catch((cause) => {
        if (generation === this.generation)
          this.patch({ error: message(cause) });
      });
  };
  update(file: ChatFile, conversation?: string): void {
    this.file = file;
    this.conversation = conversation;
    this.load();
  }
  dispose = (): void => {
    ++this.generation;
    if (this.state.src) {
      this.urls.release(this.state.src);
      this.patch({ src: "" });
    }
  };
  presentation() {
    return {
      ...this.state,
      can: this.runtime.can(contract.chat.file.fetch),
      retry: this.load,
    };
  }
}
export class StickerController extends StateStore<{
  stickers: ChatSticker[];
  recent: string[];
  pack: string;
  error: string;
}> {
  private generation = 0;
  constructor(private runtime: MediaPort) {
    super({ stickers: [], recent: [], pack: "recent", error: "" });
  }
  update(open: boolean): void {
    const generation = ++this.generation;
    if (!open) return;
    this.patch({ error: "" });
    void (async () => {
      const cached = await this.runtime.getLocal<ChatSticker[]>("stickers");
      const recent = await this.runtime.getLocal<string[]>("recent-stickers");
      if (generation !== this.generation) return;
      this.patch({ stickers: cached ?? [], recent: recent ?? [] });
      if (this.runtime.can(contract.chat.sticker.list).ok && !cached?.length) {
        const all: ChatSticker[] = [];
        let offset = 0;
        for (;;) {
          const result = await onlineCall(
            this.runtime,
            contract.chat.sticker.list,
            { offset, limit: 100 },
          );
          if (generation !== this.generation) return;
          all.push(...result.stickers);
          this.patch({ stickers: [...all] });
          if (result.next === null) break;
          offset = result.next;
        }
        await this.runtime.setLocal("stickers", all);
      }
    })().catch((cause) => {
      if (generation === this.generation) this.patch({ error: message(cause) });
    });
  }
  dispose = (): void => {
    ++this.generation;
  };
  setPack = (pack: string): void => this.patch({ pack });
  pick = async (
    sticker: ChatSticker,
    onPick: (sticker: ChatSticker) => Promise<void>,
    onClose: () => void,
  ): Promise<void> => {
    try {
      await onPick(sticker);
      const recent = [
        sticker.id,
        ...this.state.recent.filter((id) => id !== sticker.id),
      ].slice(0, 24);
      await this.runtime.setLocal("recent-stickers", recent);
      this.patch({ recent });
      onClose();
    } catch (cause) {
      this.patch({ error: message(cause) });
    }
  };
  presentation() {
    const { stickers, recent, pack } = this.state;
    const selected =
      pack === "recent"
        ? recent
            .map((id) => stickers.find((sticker) => sticker.id === id))
            .filter((sticker): sticker is ChatSticker => !!sticker)
        : stickers.filter((sticker) => sticker.pack === pack);
    const rows: ChatSticker[][] = [];
    for (let i = 0; i < selected.length; i += 4)
      rows.push(selected.slice(i, i + 4));
    return {
      ...this.state,
      selected,
      rows,
      packs: [...new Set(stickers.map((sticker) => sticker.pack))],
      can: this.runtime.can(contract.chat.sticker.list),
      setPack: this.setPack,
    };
  }
}
