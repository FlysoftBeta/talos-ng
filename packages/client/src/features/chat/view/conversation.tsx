import type { ReactElement, RefObject, ComponentType } from "react";
import { DateSeparator } from "./date-separator.tsx";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { ConfirmDialog, Dialog, Sheet } from "../../../ui/overlays/index.ts";
import {
  InlineNotice,
  OfflineHint,
  StatePanel,
} from "../../../ui/feedback/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { SelectField, Switch, TextArea } from "../../../ui/inputs/index.ts";
import {
  Avatar,
  Group,
  GroupRow,
  PaneHeader,
} from "../../../ui/layout/index.ts";
import { VirtualList } from "../../../ui/virtual/index.ts";
import type { VirtualListHandle } from "../../../ui/virtual/index.ts";
import type { ConversationController } from "../model/conversation.ts";
import type { ComposerInput } from "../model/composer.ts";
import type { BrowserInput, MembersInput } from "../model/community.ts";
import type { OriginalViewerProps } from "./media.tsx";
import type { PostCardProps } from "./post-card.tsx";
type Slots = {
  Composer: ComponentType<ComposerInput>;
  GroupBrowser: ComponentType<BrowserInput>;
  MembersSheet: ComponentType<MembersInput>;
  OriginalViewer: ComponentType<OriginalViewerProps>;
  PostCard: ComponentType<PostCardProps>;
};
type Props = ReturnType<ConversationController["presentation"]> &
  Slots & {
    height: number;
    list: RefObject<VirtualListHandle | null>;
    viewport: RefObject<HTMLDivElement | null>;
    boundary(): void;
  };
export function ConversationView({
  group,
  state,
  items,
  first,
  last,
  initial,
  unreadRemaining,
  deleteLabel,
  discardLabel,
  can,
  retain,
  cachedMembers,
  labels,
  error,
  loading,
  reply,
  settings,
  showMembers,
  discover,
  deleting,
  discard,
  original,
  textView,
  textLoading,
  selectedPost,
  awayFromBottom,
  load,
  view,
  jump,
  newest,
  retry,
  togglePin,
  toggleMute,
  retention,
  deletePost,
  discardPost,
  saveEdit,
  setReply,
  setSettings,
  setShowMembers,
  setDiscover,
  setDeleting,
  setDiscard,
  setOriginal,
  setTextView,
  setSelectedPost,
  height,
  list,
  viewport,
  boundary,
  Composer,
  GroupBrowser,
  MembersSheet,
  OriginalViewer,
  PostCard,
}: Props): ReactElement {
  const partial =
    !can.ok && ((first?.seq ?? 1) > 1 || (last?.seq ?? 0) < state.lastSeq);
  return (
    <section
      className="chat-conversation"
      aria-label={`对话：${group.name}`}
      onClickCapture={(event) => {
        if (!(event.target as HTMLElement).closest(".chat-post"))
          setSelectedPost(undefined);
      }}
    >
      <PaneHeader
        leading={
          <Avatar
            name={group.name}
            size={32}
            icon={
              group.kind === "dm" ? <Icon name="user" size={18} /> : undefined
            }
          />
        }
        title={group.name}
        subtitle={
          group.kind === "dm"
            ? "私信"
            : group.handle
              ? `@${group.handle}`
              : `${cachedMembers.length} 位成员`
        }
        actions={
          <>
            {group.kind === "group" && (
              <IconButton
                label="成员"
                icon="users"
                onClick={() => setShowMembers(true)}
              />
            )}
            <IconButton
              label="对话设置"
              icon="sliders"
              onClick={() => setSettings(true)}
            />
          </>
        }
      />
      {error && !textView && (
        <div className="chat-notice">
          <InlineNotice
            tone="failed"
            action={
              <Button size="small" onClick={() => void load("latest")}>
                重试
              </Button>
            }
          >
            {error}
          </InlineNotice>
        </div>
      )}
      <div
        className="chat-history"
        data-testid="chat.history"
        ref={viewport}
        onScrollCapture={boundary}
        onLoadCapture={() => list.current?.measure()}
      >
        {loading && items.length > 0 && (
          <div className="chat-loader" data-testid="chat.loader" role="status">
            <Icon name="loading" size={16} spin />
            <span>加载中</span>
          </div>
        )}
        {items.length ? (
          <VirtualList
            ref={list}
            items={items}
            getKey={(post) => post.id}
            height={height}
            estimatedItemHeight={44}
            stickToBottom
            ariaLabel="对话消息"
            className="chat-stream"
            renderItem={(post, index) => (
              <>
                {index === 0 && <div className="chat-stream-top" />}
                {labels[index]!.separator && (
                  <DateSeparator label={labels[index]!.date} />
                )}
                {index > 0 && post.seq > items[index - 1]!.seq + 1 && (
                  <div className="chat-gap">
                    <InlineNotice
                      tone={can.ok ? "info" : "pending"}
                      action={
                        can.ok ? (
                          <Button
                            size="small"
                            onClick={() =>
                              void load("after", items[index - 1]!.seq)
                            }
                          >
                            加载这段消息
                          </Button>
                        ) : undefined
                      }
                    >
                      缺少第 {items[index - 1]!.seq + 1}–{post.seq - 1} 条消息
                      {can.ok ? "" : "，这段历史没有保存在本机"}
                    </InlineNotice>
                  </div>
                )}
                {post.seq === initial + 1 && initial > 0 && (
                  <div className="chat-unread-divider">
                    <span>以下为未读消息</span>
                  </div>
                )}
                <PostCard
                  post={post}
                  grouped={labels[index]!.grouped}
                  selected={selectedPost === post.id}
                  onSelect={() =>
                    setSelectedPost(
                      selectedPost === post.id ? undefined : post.id,
                    )
                  }
                  reply={items.find((item) => item.id === post.replyTo)}
                  onReply={() => setReply(post)}
                  onJump={() => void jump(post.replyTo!, post.seq)}
                  onFull={() => void view(post, false)}
                  onEdit={() => void view(post, true)}
                  onDelete={() => setDeleting(post)}
                  onImage={() => setOriginal(post)}
                  onRetry={() => void retry(post)}
                  onDiscard={() => setDiscard(post)}
                />
              </>
            )}
          />
        ) : (
          <StatePanel
            state={
              loading
                ? "loading"
                : !can.ok && state.lastSeq > 0
                  ? "offline"
                  : "empty"
            }
            title={!state.lastSeq ? "还没有消息" : undefined}
            hint={!state.lastSeq ? "发送第一条消息，开始交流" : undefined}
          />
        )}
        {awayFromBottom && (
          <button
            type="button"
            className="chat-latest"
            aria-label="跳到最新消息"
            title="跳到最新消息"
            onClick={() => void newest()}
          >
            <Icon name="arrow-down" size={18} />
            {!!unreadRemaining && (
              <span className="chat-latest-count">{unreadRemaining}</span>
            )}
          </button>
        )}
      </div>
      {partial && (
        <p className="chat-partial" role="status">
          <Icon name="offline" size={14} />
          部分历史离线未缓存，联网后可补全，或在对话设置中开启离线保留
        </p>
      )}
      <Composer
        key={group.id}
        group={group}
        state={state}
        reply={reply}
        onReplyClear={() => setReply(undefined)}
      />
      <Sheet
        open={settings}
        title="对话设置"
        subtitle={group.name}
        onClose={() => setSettings(false)}
      >
        <Group>
          <GroupRow label="置顶对话" hint="显示在列表顶部">
            <Switch
              label="置顶对话"
              checked={!!state.pin.v}
              onChange={() => void togglePin()}
            />
          </GroupRow>
          <GroupRow label="免打扰" hint="新消息不弹出提醒">
            <Switch
              label="免打扰"
              checked={!!state.mute.v}
              onChange={() => void toggleMute()}
            />
          </GroupRow>
        </Group>
        <Group
          title="离线保留"
          hint="按发送时间下载最近一周或半年的正文和原图，并持续更新；进度见状态中心。"
        >
          <GroupRow label="保留范围" stacked>
            <OfflineHint
              label="离线保留"
              block
              reason={!retain.ok ? retain.reason : undefined}
            >
              <SelectField
                label="离线保留"
                hideLabel
                value={state.retention.v}
                onChange={(e) => void retention(e.target.value)}
              >
                <option value="auto">自动缓存</option>
                <option value="week">保留一周</option>
                <option value="half-year">保留半年</option>
              </SelectField>
            </OfflineHint>
          </GroupRow>
        </Group>
        {group.kind === "group" && (
          <Group title="子群组">
            <button
              type="button"
              className="chat-settings-link"
              onClick={() => {
                setSettings(false);
                setDiscover(true);
              }}
            >
              <span>发现子群组</span>
              <Icon name="forward" size={18} />
            </button>
          </Group>
        )}
      </Sheet>
      <MembersSheet
        group={group}
        open={showMembers}
        onClose={() => setShowMembers(false)}
        cached={cachedMembers}
      />
      <GroupBrowser
        parent={group}
        open={discover}
        onClose={() => setDiscover(false)}
      />
      <ConfirmDialog
        open={!!deleting}
        objectName={deleteLabel}
        destructive
        message="删除后消息正文和附件将永久移除，回复关系保留。"
        onClose={() => setDeleting(undefined)}
        onConfirm={() => void deletePost()}
      />
      <ConfirmDialog
        open={!!discard}
        objectName={discardLabel}
        title={`放弃「${discardLabel}」？`}
        message="这条未发送的消息将从本机移除。"
        onClose={() => setDiscard(undefined)}
        onConfirm={() => void discardPost()}
      />
      <OriginalViewer post={original} onClose={() => setOriginal(undefined)} />
      <Dialog
        open={!!textView}
        size="lg"
        title={textView?.edit ? "编辑消息" : "完整正文"}
        onClose={() => setTextView(undefined)}
        footer={
          textView?.edit && !textLoading && !error ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setTextView(undefined)}
              >
                取消
              </Button>
              <Button variant="primary" onClick={() => void saveEdit()}>
                保存编辑
              </Button>
            </>
          ) : undefined
        }
      >
        {textLoading ? (
          <StatePanel state="loading" />
        ) : error ? (
          <StatePanel
            state={can.ok ? "error" : "offline"}
            hint={error}
            action={
              can.ok && textView ? (
                <Button onClick={() => void view(textView.post, textView.edit)}>
                  重试
                </Button>
              ) : undefined
            }
          />
        ) : textView?.edit ? (
          <TextArea
            label="编辑正文"
            value={textView.body}
            rows={14}
            onChange={(e) => setTextView({ ...textView, body: e.target.value })}
          />
        ) : (
          <div
            className="chat-full-text selectable"
            data-testid="chat.post.full-text"
          >
            {textView?.body}
          </div>
        )}
      </Dialog>
    </section>
  );
}
