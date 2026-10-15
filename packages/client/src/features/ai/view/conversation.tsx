import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { AiMessage } from "@talos/contract";
import type { Scroller } from "@talos/virtual";
import { VirtualScroller } from "../../../ui/virtual/index.ts";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { Field, FileButton, SharedComposer } from "../../../ui/inputs/index.ts";
import { PaneHeader, Stack } from "../../../ui/layout/index.ts";
import { InlineNotice, Mark, useToast } from "../../../ui/feedback/index.ts";
import { Sheet, Menu } from "../../../ui/overlays/index.ts";
import {
  imageName,
  messageInFlight,
  messageStatusLabel,
  tagsText,
} from "../model/conversation.ts";
import type { ConversationState } from "../model/conversation.ts";
import { Icon } from "../../../ui/icon/index.ts";
import "./ai.css";

export interface ConversationActions {
  onText: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onFork: (message: string) => void;
  onAddImage: (file: File | undefined) => void;
  onRemoveImage: (index: number) => void;
  onSaveDetails: (title: string, tags: string) => Promise<boolean>;
}
export function ConversationView({
  state,
  transcript,
  actions,
  messageBody,
  workspace,
}: {
  state: ConversationState;
  /** Scrolls the messages; follows the end while the reader is there. */
  transcript: Scroller<AiMessage>;
  actions: ConversationActions;
  /** Connected renderer for one message body (loads truncated text). */
  messageBody: (message: AiMessage) => ReactNode;
  /** Connected workspace sheet. */
  workspace: (sheet: { open: boolean; onClose: () => void }) => ReactNode;
}): ReactElement {
  const c = state.conversation;
  const toast = useToast();
  const [showWorkspace, setShowWorkspace] = useState(false),
    [editing, setEditing] = useState(false),
    [title, setTitle] = useState(c?.title ?? ""),
    [tags, setTags] = useState(tagsText(c?.tags ?? []));
  return (
    <div className="ai-conversation" data-testid="ai.conversation">
      <PaneHeader
        title={c?.title}
        titleTestId="ai.conversation.title"
        subtitle={c?.tags.join(" · ")}
        actions={
          <>
            <IconButton
              label="标题与标签"
              icon="edit"
              onClick={() => {
                setTitle(c?.title ?? "");
                setTags(tagsText(c?.tags ?? []));
                setEditing(true);
              }}
            />
            <Menu
              label="对话操作"
              items={[
                {
                  label: "工作区",
                  icon: "folder",
                  onSelect: () => setShowWorkspace(true),
                },
              ]}
            />
          </>
        }
      />
      {state.messages.length ? (
        <VirtualScroller
          scroller={transcript}
          className="ai-messages ai-transcript"
          label="对话消息"
          renderEdge={(direction, edge) =>
            direction === "before" ? (
              <div className="ai-transcript-edge">
                {edge.state === "loading" ? (
                  <span className="ai-transcript-status" role="status">
                    <Icon name="loading" size={16} spin />
                    加载更早消息
                  </span>
                ) : edge.state === "failed" ? (
                  <InlineNotice
                    tone="failed"
                    action={
                      <Button
                        size="small"
                        disabled={!state.send.ok}
                        onClick={() => transcript.retry()}
                      >
                        重试
                      </Button>
                    }
                  >
                    {state.send.ok
                      ? "更早的消息暂时无法加载"
                      : state.send.reason}
                  </InlineNotice>
                ) : null}
              </div>
            ) : (
              <div className="ai-transcript-edge" />
            )
          }
          renderItem={(m) => (
            <div className="ai-column">
              <article
                className={`ai-message ai-${m.role}`}
                data-testid="ai.message"
                data-role={m.role}
                data-message-id={m.id}
                tabIndex={0}
              >
                {m.role === "assistant" && (
                  <span className="ai-answer-mark">
                    <Icon name="ai" size={18} />
                  </span>
                )}
                <div className="ai-message-body">{messageBody(m)}</div>
                {messageInFlight(m.status) && (
                  <span className="ai-caret" aria-label="正在生成" />
                )}
                {m.status === "failed" ? (
                  <Mark state="failed" label="生成失败" />
                ) : !messageInFlight(m.status) && m.status !== "done" ? (
                  <small className="ai-message-status">
                    {messageStatusLabel(m.status)}
                  </small>
                ) : null}
                {m.images.map((i) => (
                  <small key={i.path}>图片：{imageName(i.path)}</small>
                ))}
                {m.error && <p role="alert">{m.error}</p>}
                {!messageInFlight(m.status) && (
                  <div className="ai-message-actions">
                    <IconButton
                      label="从此创建分支"
                      icon="fork"
                      disabledReason={
                        !state.send.ok ? state.send.reason : undefined
                      }
                      onClick={() => actions.onFork(m.id)}
                    />
                    <IconButton
                      label="复制消息"
                      icon="copy"
                      onClick={() => {
                        const article = document.querySelector<HTMLElement>(
                          `[data-message-id="${m.id}"] .ai-message-body`,
                        );
                        if (!article) return;
                        const selection = window.getSelection();
                        const range = document.createRange();
                        range.selectNodeContents(article);
                        selection?.removeAllRanges();
                        selection?.addRange(range);
                        try {
                          toast(
                            document.execCommand("copy")
                              ? "已复制"
                              : "请长按选择文字复制",
                          );
                        } catch {
                          toast("请长按选择文字复制");
                        }
                        selection?.removeAllRanges();
                      }}
                    />
                  </div>
                )}
              </article>
            </div>
          )}
        />
      ) : (
        <div className="ai-messages">
          <div className="ai-greeting">
            <Icon name="ai" size={32} />
            <h2>有什么可以帮你？</h2>
          </div>
        </div>
      )}
      <div className="ai-compose" data-testid="ai.composer">
        {state.error && (
          <InlineNotice tone="failed">{state.error}</InlineNotice>
        )}
        <SharedComposer
          data-testid="ai.composer.input"
          placeholder="发消息…"
          value={state.text}
          maxLength={100000}
          disabled={!state.draft.ok}
          onChange={(e) => actions.onText(e.target.value)}
          onSend={() => {
            if (c?.running) {
              if (state.stop.ok) actions.onStop();
            } else if (!state.reason) actions.onSend();
          }}
          sendLabel={c?.running ? "停止生成" : "发送"}
          sendDisabled={c?.running ? !state.stop.ok : !!state.reason}
          above={
            <small className="ai-compose-hint" role="status">
              {state.reason || "Enter 发送 · Shift+Enter 换行"}
            </small>
          }
          after={state.images.map((p, i) => (
            <button
              className="ai-image-chip"
              key={p}
              onClick={() => actions.onRemoveImage(i)}
              aria-label={`移除图片 ${i + 1}`}
            >
              {state.previews[p] && <img src={state.previews[p]} alt="" />}
              <span className="ai-chip-remove">
                <Icon name="close" size={14} />
              </span>
            </button>
          ))}
          actions={
            <FileButton
              label="图片"
              accept="image/png,image/jpeg,image/gif,image/webp"
              disabledReason={
                !state.canAddImage
                  ? !state.send.ok
                    ? state.send.reason
                    : "最多添加四张图片，请等待上传完成"
                  : undefined
              }
              onFile={actions.onAddImage}
            />
          }
        />
      </div>
      {workspace({
        open: showWorkspace,
        onClose: () => setShowWorkspace(false),
      })}
      <Sheet
        open={editing}
        title="标题与标签"
        onClose={() => setEditing(false)}
        footer={
          <>
            <Button onClick={() => setEditing(false)}>取消</Button>
            <Button
              variant="primary"
              disabledReason={!state.send.ok ? state.send.reason : undefined}
              onClick={() =>
                void actions.onSaveDetails(title, tags).then((saved) => {
                  if (saved) setEditing(false);
                })
              }
            >
              保存标题与标签
            </Button>
          </>
        }
      >
        <Stack>
          <Field
            label="标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Field
            label="标签（逗号分隔）"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </Stack>
      </Sheet>
    </div>
  );
}
