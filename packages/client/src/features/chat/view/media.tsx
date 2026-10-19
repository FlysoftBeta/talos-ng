import { useRef } from "react";
import type { ReactElement, ComponentType, RefObject } from "react";
import type { ChatFile, ChatPost, ChatSticker } from "@talos/contract";
import type {
  CachedImageController,
  StickerController,
} from "../model/media.ts";
import { Button } from "../../../ui/actions/index.ts";
import { Dialog } from "../../../ui/overlays/index.ts";
import { Portal } from "../../../ui/floating/layers.tsx";
import {
  useFloating,
  moveFloatingFocus,
} from "../../../ui/floating/use-floating.ts";
import { FileButton } from "../../../ui/inputs/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import {
  VirtualScroller,
  useArrayScroller,
} from "../../../ui/virtual/index.ts";
export interface CachedImageProps {
  file: ChatFile;
  conversation?: string;
  label: string;
  onOpen?: () => void;
}
export interface StickerPickerProps {
  open: boolean;
  onClose(): void;
  onPick(sticker: ChatSticker): Promise<void>;
  /** The button that opens the panel; the panel aligns to it. */
  anchor: RefObject<HTMLElement | null>;
  /** The composer field; the panel sits above it and never covers it. */
  clear: RefObject<HTMLElement | null>;
}
export interface OriginalViewerProps {
  post: ChatPost | undefined;
  onClose(): void;
}
export type ImageSlot = ComponentType<CachedImageProps>;
export function CachedImageView({
  src,
  error,
  can,
  retry,
  label,
  onOpen,
}: ReturnType<CachedImageController["presentation"]> &
  CachedImageProps): ReactElement {
  if (error)
    return (
      <span className={`chat-image-missing${can.ok ? "" : " is-offline"}`}>
        <Icon name={can.ok ? "image" : "offline"} size={20} />
        <span>{can.ok ? "图片暂时无法读取" : "图片离线未缓存"}</span>
        {can.ok && (
          <Button size="small" variant="secondary" onClick={retry}>
            重试图片
          </Button>
        )}
      </span>
    );
  if (!src)
    return (
      <span
        className="chat-image-skeleton"
        role="status"
        aria-label="图片加载中"
      />
    );
  return onOpen ? (
    <button
      className="chat-image-button"
      aria-label={`查看原图：${label}`}
      onClick={onOpen}
    >
      <img src={src} alt={label} className="chat-image" />
    </button>
  ) : (
    <img src={src} alt={label} className="chat-image" />
  );
}
export function OriginalViewerView({
  post,
  onClose,
  CachedImage,
}: OriginalViewerProps & { CachedImage: ImageSlot }): ReactElement {
  return (
    <Dialog open={!!post} size="xl" title="原始图片" onClose={onClose}>
      {post?.image && (
        <div className="chat-original">
          <CachedImage
            file={post.image.original}
            conversation={post.conversation}
            label="原始图片"
          />
        </div>
      )}
    </Dialog>
  );
}
export function StickerPickerView({
  open,
  onClose,
  onPick,
  anchor,
  clear,
  CachedImage,
  stickers,
  pack,
  error,
  selected,
  rows,
  packs,
  can,
  setPack,
}: StickerPickerProps &
  ReturnType<StickerController["presentation"]> & {
    CachedImage: ImageSlot;
  }): ReactElement {
  const scroller = useArrayScroller(rows, {
    key: stickerRowKey,
    equals: (a, b) => stickerRowKey(a) === stickerRowKey(b),
    size: () => 96,
    estimate: 96,
  });
  const surface = useRef<HTMLDivElement>(null);
  useFloating({
    open,
    anchor,
    surface,
    clear,
    side: "above",
    onClose,
    focus: true,
  });
  if (!open) return <></>;
  return (
    <Portal>
      <div
        ref={surface}
        tabIndex={-1}
        onKeyDown={moveFloatingFocus}
        className="floating-surface chat-sticker-panel"
        role="dialog"
        aria-label="发送贴纸"
      >
        <div className="tabs chat-pack-tabs" role="tablist" aria-label="贴纸包">
          {["recent", ...packs].map((name) => (
            <button
              key={name}
              role="tab"
              aria-selected={pack === name}
              onClick={() => setPack(name)}
            >
              {name === "recent" ? "最近使用" : name}
            </button>
          ))}
        </div>
        {error && <StatePanel state="error" hint={error} compact />}
        {!selected.length ? (
          <StatePanel
            state={!can.ok && !stickers.length ? "offline" : "empty"}
            title={pack === "recent" ? "还没有最近使用的贴纸" : undefined}
            hint="从贴纸包中选择一张贴纸"
          />
        ) : (
          <VirtualScroller
            scroller={scroller}
            label="贴纸"
            style={{ height: 240 }}
            renderItem={(row) => (
              <div className="chat-sticker-row">
                {row.map((sticker) => (
                  <button
                    className="chat-sticker"
                    data-testid="chat.sticker"
                    key={sticker.id}
                    aria-label={`发送贴纸：${sticker.name}`}
                    onClick={() => {
                      void onPick(sticker);
                    }}
                  >
                    <CachedImage file={sticker.file} label={sticker.name} />
                  </button>
                ))}
              </div>
            )}
          />
        )}
      </div>
    </Portal>
  );
}
const stickerRowKey = (row: readonly ChatSticker[]): string =>
  row.map((sticker) => sticker.id).join(" ");
export function ImageField({
  disabled,
  onFile,
}: {
  disabled: boolean;
  onFile: (file: File) => void;
}): ReactElement {
  return (
    <FileButton
      label="图片"
      accept="image/*"
      disabled={disabled}
      onFile={(file) => {
        if (file) onFile(file);
      }}
    />
  );
}
