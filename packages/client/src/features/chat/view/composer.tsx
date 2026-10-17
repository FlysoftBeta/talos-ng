import { useRef } from "react";
import type { ReactElement, ComponentType, RefObject } from "react";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { Dialog } from "../../../ui/overlays/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { InlineNotice, Progress } from "../../../ui/feedback/index.ts";
import { TextArea, SharedComposer } from "../../../ui/inputs/index.ts";
import type { ComposerController } from "../model/composer.ts";
import type { ChatSticker } from "@talos/contract";
import { ImageField } from "./media.tsx";
export type ComposerViewProps = ReturnType<
  ComposerController["presentation"]
> & {
  onFile(file: File): void;
  StickerPicker: ComponentType<{
    open: boolean;
    onClose(): void;
    onPick(sticker: ChatSticker): Promise<void>;
    anchor: RefObject<HTMLElement | null>;
    clear: RefObject<HTMLElement | null>;
  }>;
};
export function ComposerView({
  text,
  fullscreen,
  stickers,
  images,
  error,
  busy,
  progress,
  reply,
  onReplyClear,
  restricted,
  imageReason,
  imageAllowed,
  sendDisabled,
  maxText,
  fullscreenSendDisabled,
  showCount,
  textCount,
  maxTextCount,
  progressLabel,
  replyLabel,
  change,
  persist,
  send,
  pick,
  setFullscreen,
  setStickers,
  setImages,
  onFile,
  StickerPicker,
}: ComposerViewProps): ReactElement {
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLElement>(null);
  return (
    <section ref={field} className="chat-composer" aria-label="消息编辑器">
      <SharedComposer
        data-testid="chat.composer.input"
        value={text}
        placeholder="发消息…"
        maxLength={maxText}
        disabled={!!restricted || busy}
        onChange={(e) => change(e.target.value)}
        onBlur={() => persist()}
        onSend={() => void send()}
        sendDisabled={sendDisabled}
        above={
          reply ||
          restricted ||
          imageReason ||
          error ||
          progress !== undefined ? (
            <div className="chat-composer-above">
              {reply && (
                <div className="chat-reply-preview">
                  <Icon name="reply" size={16} />
                  <span className="ellipsis">回复 {replyLabel}</span>
                  <IconButton
                    size="small"
                    label="取消回复"
                    icon="close"
                    onClick={onReplyClear}
                  />
                </div>
              )}
              {restricted && (
                <InlineNotice tone="pending">{restricted}</InlineNotice>
              )}
              {!!imageReason && <InlineNotice>{imageReason}</InlineNotice>}
              {progress !== undefined && (
                <div className="chat-upload" role="status">
                  <span>上传图片 {progressLabel}%</span>
                  <Progress label="上传图片" value={progress} />
                </div>
              )}
              {error && <InlineNotice tone="failed">{error}</InlineNotice>}
            </div>
          ) : undefined
        }
        actions={
          <>
            <IconButton
              ref={trigger}
              label="贴纸"
              icon="sticker"
              aria-expanded={stickers}
              pressed={stickers ? true : undefined}
              disabled={!!restricted}
              onClick={() => setStickers(!stickers)}
            />
            <IconButton
              label="图片"
              icon="image"
              pressed={images}
              disabled={!imageAllowed}
              onClick={() => setImages(!images)}
            />
            <IconButton
              label="全屏编辑"
              icon="expand"
              disabled={!!restricted}
              onClick={() => setFullscreen(true)}
            />
          </>
        }
        after={
          images || showCount ? (
            <>
              {images && (
                <span className="chat-image-pick">
                  <ImageField
                    disabled={!imageAllowed || busy}
                    onFile={onFile}
                  />
                  <span className="muted">
                    PNG、JPEG、GIF 或 BMP，最大 12 MiB
                  </span>
                </span>
              )}
              {showCount && (
                <small className="chat-count num">
                  {textCount} / {maxTextCount}
                </small>
              )}
            </>
          ) : undefined
        }
      />
      <Dialog
        open={fullscreen}
        size="xl"
        title="全屏编辑"
        subtitle="Enter 换行 · 草稿自动保存"
        onClose={() => {
          persist();
          setFullscreen(false);
        }}
        footer={
          <>
            <small className="chat-count num">
              {textCount} / {maxTextCount}
            </small>
            <Button variant="secondary" onClick={() => setFullscreen(false)}>
              返回对话
            </Button>
            <Button
              variant="primary"
              disabled={fullscreenSendDisabled}
              onClick={() => void send()}
            >
              发送
            </Button>
          </>
        }
      >
        <TextArea
          label="完整正文"
          className="chat-fullscreen-editor"
          maxLength={maxText}
          value={text}
          rows={18}
          disabled={!!restricted || busy}
          onChange={(e) => change(e.target.value)}
          onBlur={() => persist()}
        />
      </Dialog>
      <StickerPicker
        open={stickers}
        onClose={() => setStickers(false)}
        onPick={pick}
        anchor={trigger}
        clear={field}
      />
    </section>
  );
}
