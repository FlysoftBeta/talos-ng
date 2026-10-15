import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { ConfirmDialog, Sheet } from "../../../ui/overlays/index.ts";
import { Field, SelectField } from "../../../ui/inputs/index.ts";
import {
  InlineNotice,
  ListRow,
  OfflineHint,
  StatePanel,
} from "../../../ui/feedback/index.ts";
import { Avatar, Group, Stack, Tag } from "../../../ui/layout/index.ts";
import { Checkbox, SearchField } from "../../../ui/inputs/index.ts";
import type {
  GroupBrowserController,
  CreateGroupController,
  MembersController,
} from "../model/community.ts";
export function GroupBrowserView({
  open,
  parent,
  onClose,
  can,
  query,
  groups,
  selected,
  password,
  error,
  busy,
  setQuery,
  setPassword,
  select,
  search,
  join,
}: ReturnType<GroupBrowserController["presentation"]>): ReactElement {
  return (
    <Sheet
      open={open}
      title={parent ? `「${parent.name}」的子群组` : "查找群组"}
      onClose={onClose}
    >
      <Stack>
        {!parent && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <div className="chat-find">
              <SearchField
                label="群组名称或标识"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={busy}
                disabledReason={!can.ok ? can.reason : undefined}
              >
                查找
              </Button>
            </div>
          </form>
        )}
        {error && (
          <InlineNotice
            tone="failed"
            action={
              <Button size="small" onClick={() => void search()}>
                重试
              </Button>
            }
          >
            {error}
          </InlineNotice>
        )}
        {!can.ok ? (
          <StatePanel state="offline" hint={can.reason} />
        ) : busy ? (
          <StatePanel state="loading" />
        ) : groups?.length === 0 ? (
          <StatePanel
            state="empty"
            title="没有可加入的群组"
            hint="只有允许发现且你有权访问的群组会显示在这里"
          />
        ) : (
          <div className="chat-sheet-rows">
            {groups?.map((group) => (
              <ListRow
                key={group.id}
                title={group.name}
                hint={group.handle ? `@${group.handle}` : "公开群组"}
                leading={<Avatar name={group.name} />}
                selected={selected?.id === group.id}
                trailing={
                  group.passwordRequired ? <Tag>需密码</Tag> : undefined
                }
                onClick={() => {
                  select(group);
                }}
              />
            ))}
          </div>
        )}
        {selected && (
          <section className="chat-join">
            <h3>加入「{selected.name}」</h3>
            {selected.passwordRequired && (
              <Field
                label="群组密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            <Button
              variant="primary"
              block
              disabled={busy || !can.ok}
              onClick={() => void join()}
            >
              加入群组
            </Button>
          </section>
        )}
      </Stack>
    </Sheet>
  );
}
export function CreateGroupSheetView({
  open,
  groups,
  onClose,
  can,
  name,
  handle,
  password,
  parent,
  discoverable,
  hidden,
  adminOnly,
  busy,
  error,
  setName,
  setHandle,
  setPassword,
  setParent,
  setDiscoverable,
  setHidden,
  setAdminOnly,
  create,
  createDisabled,
}: ReturnType<CreateGroupController["presentation"]>): ReactElement {
  return (
    <Sheet open={open} title="创建群组" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Stack>
          <Field
            label="群组名称"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Field
            label="群组标识（可选）"
            hint="字母、数字、下划线或连字符，最多 32 字符"
            maxLength={32}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
          <Field
            label="加入密码（可选）"
            type="password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <SelectField
            label="所属群组"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
          >
            <option value="">无上级群组</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </SelectField>
          <div className="chat-checks">
            <Checkbox
              label="允许查找和发现"
              checked={discoverable}
              onChange={(e) => setDiscoverable(e.target.checked)}
            />
            <Checkbox
              label="隐藏成员名单"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
            <Checkbox
              label="仅管理员可发言"
              checked={adminOnly}
              onChange={(e) => setAdminOnly(e.target.checked)}
            />
          </div>
          {error && <InlineNotice tone="failed">{error}</InlineNotice>}
          <Button
            type="submit"
            variant="primary"
            block
            busy={busy}
            disabled={createDisabled}
            disabledReason={!can.ok ? can.reason : undefined}
          >
            创建群组
          </Button>
        </Stack>
      </form>
    </Sheet>
  );
}
export function MembersSheetView({
  group,
  open,
  onClose,
  can,
  members,
  showHiddenNotice,
  canLeave,
  selfHidden,
  error,
  leave,
  dm,
  hide,
  leaveGroup,
  setLeave,
}: ReturnType<MembersController["presentation"]>): ReactElement {
  return (
    <Sheet open={open} title={`「${group.name}」的成员`} onClose={onClose}>
      <Stack>
        {showHiddenNotice && (
          <InlineNotice>
            本群隐藏成员名单；仅展示你有权查看的成员。
          </InlineNotice>
        )}
        {!can.ok && !members.length ? (
          <StatePanel state="offline" />
        ) : (
          <Group title={`${members.length} 位成员`}>
            {members.map((member) => (
              <ListRow
                key={member.user}
                title={member.name}
                hint={member.handle ? `@${member.handle}` : "成员"}
                leading={<Avatar name={member.name} size={32} />}
                trailing={
                  member.self ? (
                    <Tag>我</Tag>
                  ) : (
                    <Button
                      size="small"
                      variant="secondary"
                      disabledReason={!can.ok ? can.reason : undefined}
                      onClick={() => void dm(member.user)}
                    >
                      私信
                    </Button>
                  )
                }
              />
            ))}
          </Group>
        )}
        <OfflineHint
          label="隐藏自己"
          block
          reason={!can.ok ? can.reason : undefined}
        >
          <Checkbox
            label="在成员名单中隐藏自己"
            hint="不影响已发送消息上的署名"
            checked={selfHidden}
            onChange={(e) => {
              void hide(e.target.checked);
            }}
          />
        </OfflineHint>
        {error && <InlineNotice tone="failed">{error}</InlineNotice>}
        {!canLeave ? (
          <p className="muted t-2">系统群组不可退出。</p>
        ) : (
          <Button
            variant="danger-ghost"
            icon="logout"
            disabledReason={!can.ok ? can.reason : undefined}
            onClick={() => setLeave(true)}
          >
            退出群组
          </Button>
        )}
        <ConfirmDialog
          open={leave}
          objectName={group.name}
          title={`退出「${group.name}」？`}
          message="退出后本机缓存的消息和图片会被移除；未发送的草稿保留。"
          confirmLabel="确认"
          onClose={() => setLeave(false)}
          onConfirm={() => void leaveGroup()}
        />
      </Stack>
    </Sheet>
  );
}
