import type { ReactElement } from "react";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { Avatar, Tag } from "../../../ui/layout/index.ts";
import { Mark } from "../../../ui/feedback/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import type { PostView } from "../model/module.ts";
import type { PostCardController } from "../model/post-card.ts";
import type { ImageSlot } from "./media.tsx";
export interface PostCardProps {
  post: PostView;
  reply?: PostView;
  onReply: () => void;
  onJump: () => void;
  onFull: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onImage: () => void;
  onRetry: () => void;
  onDiscard: () => void;
  grouped?: boolean;
  selected?: boolean;
  onSelect: () => void;
}
/** A post is a row: avatar and author head a group; actions float on the selected post. */
export function PostCardView({
  post,
  onReply,
  onJump,
  onFull,
  onEdit,
  onDelete,
  onImage,
  onRetry,
  onDiscard,
  grouped = false,
  selected = false,
  onSelect,
  own,
  textPreview,
  bodyLengthLabel,
  replyLabel,
  bodyLength,
  edit,
  editable,
  deletable,
  createdLabel,
  deletedLabel,
  onCopy,
  CachedImage,
}: PostCardProps &
  ReturnType<PostCardController["presentation"]> & {
    CachedImage: ImageSlot;
  }): ReactElement {
  const author = post.authorName || "无主内容";
  const actions = selected && !post.deletedAt;
  return (
    <article
      className={`chat-post${own ? " is-own" : ""}${grouped ? " is-grouped" : ""}${selected ? " is-selected" : ""}${post.pending ? " is-pending" : ""}${post.failed ? " is-failed" : ""}`}
      data-testid="chat.post"
      data-post-id={post.id}
      data-selected={selected ? "true" : undefined}
      data-seq={post.pending || post.failed ? undefined : post.seq}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("button")) onSelect();
      }}
    >
      <div className="chat-post-gutter">
        {grouped ? (
          <time className="chat-post-hover-time">{createdLabel}</time>
        ) : (
          <Avatar name={author} size={36} />
        )}
      </div>
      <div className="chat-post-main">
        {!grouped && (
          <header className="chat-post-header">
            <strong className="ellipsis">{author}</strong>
            <time>{createdLabel}</time>
            {post.edited && <Tag>已编辑</Tag>}
          </header>
        )}
        {post.deletedAt ? (
          <p className="chat-post-deleted">消息已删除 · {deletedLabel}</p>
        ) : (
          <>
            {post.replyTo && (
              <button
                type="button"
                className="chat-quote"
                aria-label={`跳到被回复的消息：${replyLabel}`}
                onClick={onJump}
              >
                <Icon name="reply" size={14} />
                <span className="ellipsis">{replyLabel}</span>
              </button>
            )}
            {post.kind === "text" ? (
              <>
                <p
                  className="chat-post-text selectable"
                  data-testid="chat.post.text"
                >
                  {textPreview}
                </p>
                {bodyLength > 500 && (
                  <button type="button" className="chat-more" onClick={onFull}>
                    阅读全文（{bodyLengthLabel} 字符）
                  </button>
                )}
              </>
            ) : post.image ? (
              <div className="chat-post-image">
                <CachedImage
                  file={post.image.thumbnail}
                  conversation={post.conversation}
                  label={`${post.authorName}发送的图片`}
                  onOpen={onImage}
                />
              </div>
            ) : post.sticker ? (
              <div
                className="chat-post-sticker"
                data-testid="chat.post.sticker"
              >
                <CachedImage
                  file={post.sticker.file}
                  label={post.sticker.name}
                />
              </div>
            ) : (
              <p className="chat-post-deleted">贴纸</p>
            )}
            {(post.pending || post.failed) && (
              <div className="chat-post-state">
                {post.pending && <Mark state="pending" />}
                {post.failed && (
                  <>
                    <Mark state="failed" onRetry={onRetry} />
                    <Button
                      size="small"
                      variant="danger-ghost"
                      onClick={onDiscard}
                    >
                      放弃
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {actions && (
        <div className="chat-post-actions" role="toolbar" aria-label="消息操作">
          {!post.pending && !post.failed && (
            <IconButton
              size="small"
              label="回复"
              icon="reply"
              onClick={onReply}
            />
          )}
          {post.kind === "text" && (
            <IconButton
              size="small"
              label="复制"
              icon="copy"
              onClick={onCopy}
            />
          )}
          {editable && (
            <IconButton
              size="small"
              label="编辑"
              icon="edit"
              disabledReason={!edit.ok ? edit.reason : undefined}
              onClick={onEdit}
            />
          )}
          {deletable && (
            <IconButton
              size="small"
              label="删除"
              icon="trash"
              tone="danger"
              disabledReason={!edit.ok ? edit.reason : undefined}
              onClick={onDelete}
            />
          )}
        </div>
      )}
    </article>
  );
}
