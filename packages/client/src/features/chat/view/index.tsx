import { useRef } from "react";
import type { ReactElement, ReactNode, ComponentType } from "react";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { Dialog, Menu } from "../../../ui/overlays/index.ts";
import {
  InlineNotice,
  ListRow,
  StatePanel,
} from "../../../ui/feedback/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import {
  Avatar,
  EmptyPane,
  Pane,
  PaneBody,
  PaneHeader,
} from "../../../ui/layout/index.ts";
import type { ChatListController, chatContent } from "../model/chat-list.ts";
import type { BackgroundController } from "../model/background.ts";
import type { CreateInput, BrowserInput } from "../model/community.ts";
import "./chat.css";
export function ChatListView({
  create,
  find,
  groups,
  entries,
  offline,
  setCreate,
  setFind,
  openConversation,
  CreateGroupSheet,
  GroupBrowser,
}: ReturnType<ChatListController["presentation"]> & {
  CreateGroupSheet: ComponentType<CreateInput>;
  GroupBrowser: ComponentType<BrowserInput>;
}): ReactElement {
  return (
    <Pane className="chat-list" data-testid="chat.list">
      <PaneHeader
        title="对话"
        actions={
          <Menu
            label="添加对话"
            icon="plus"
            items={[
              {
                label: "创建群组",
                icon: "users",
                onSelect: () => setCreate(true),
              },
              {
                label: "查找群组",
                icon: "search",
                onSelect: () => setFind(true),
              },
            ]}
          />
        }
      />
      <PaneBody className="chat-list-body">
        {!groups.length ? (
          <StatePanel
            state={offline ? "offline" : "empty"}
            title="暂无对话"
            hint="创建群组，或查找你想加入的群组"
          />
        ) : (
          entries.map((group) => (
            <ListRow
              key={group.id}
              title={group.name}
              hint={group.hint || " "}
              meta={group.time}
              selected={group.selected}
              leading={<Avatar name={group.name} />}
              titleSuffix={
                group.pinned || group.muted ? (
                  <>
                    {group.pinned && (
                      <span title="置顶">
                        <Icon name="pin" size={14} />
                      </span>
                    )}
                    {group.muted && (
                      <span title="免打扰">
                        <Icon name="mute" size={14} />
                      </span>
                    )}
                  </>
                ) : undefined
              }
              badge={
                group.unread ? (
                  <span
                    className={`badge badge-${group.muted ? "muted" : "accent"}`}
                  >
                    {group.unread}
                  </span>
                ) : undefined
              }
              onClick={() => openConversation(group.id)}
            />
          ))
        )}
      </PaneBody>
      <CreateGroupSheet
        open={create}
        groups={groups}
        onClose={() => setCreate(false)}
      />
      <GroupBrowser open={find} onClose={() => setFind(false)} />
    </Pane>
  );
}
export function ChatContentView({
  content,
  children,
}: {
  content: ReturnType<typeof chatContent>;
  children?: ReactNode;
}): ReactElement {
  if (children) return <>{children}</>;
  return content.emptyState === "empty" ? (
    <EmptyPane icon="chat" hint="选择一个对话" />
  ) : (
    <StatePanel
      state={content.emptyState}
      title={content.title}
      hint={content.hint}
    />
  );
}
export function ChatBackgroundView({
  banner,
  announcement,
  error,
  ackCan,
  preview,
  dismiss,
  open,
  lock,
  acknowledge,
}: ReturnType<BackgroundController["presentation"]>): ReactElement {
  const touch = useRef<number | undefined>(undefined);
  return (
    <>
      {banner && (
        <div
          className="chat-banner"
          data-testid="chat.banner"
          role="status"
          onTouchStart={(e) => {
            touch.current = e.touches[0]?.clientY;
          }}
          onTouchEnd={(e) => {
            if (
              touch.current !== undefined &&
              touch.current - (e.changedTouches[0]?.clientY ?? touch.current) >=
                48
            )
              dismiss();
          }}
        >
          <button
            type="button"
            className="chat-banner-open"
            onClick={open}
            data-testid="chat.banner.open"
          >
            <Avatar name={banner.name} size={32} />
            <span className="chat-banner-copy">
              <strong className="ellipsis">
                {banner.name} · {banner.post.authorName}
              </strong>
              <span className="ellipsis" data-testid="chat.banner.preview">
                {preview}
              </span>
            </span>
          </button>
          <IconButton
            label="关闭消息提醒"
            icon="close"
            size="small"
            data-testid="chat.banner.dismiss"
            onClick={dismiss}
          />
        </div>
      )}
      <Dialog
        open={!!announcement}
        title={announcement?.title ?? "公告"}
        subtitle="请阅读后确认"
        dismissible={false}
        onEscape={lock}
        onClose={() => undefined}
        footer={
          <Button variant="primary" disabled={!ackCan.ok} onClick={acknowledge}>
            我已阅读并确认
          </Button>
        }
      >
        <div className="chat-announcement selectable">{announcement?.text}</div>
        {error && <InlineNotice tone="failed">{error}</InlineNotice>}
      </Dialog>
    </>
  );
}
