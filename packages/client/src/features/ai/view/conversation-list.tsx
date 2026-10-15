import type { ReactElement, ReactNode } from "react";
import type { AiCredit, AiConversation } from "@talos/contract";
import { IconButton } from "../../../ui/actions/index.ts";
import { SearchField } from "../../../ui/inputs/index.ts";
import {
  Pane,
  PaneHeader,
  PaneTools,
  PaneBody,
} from "../../../ui/layout/index.ts";
import {
  Badge,
  ListRow,
  Progress,
  StatePanel,
} from "../../../ui/feedback/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import type { AiListState } from "../model/conversation-list.ts";
import "./ai.css";

export function ConversationListView({
  state,
  onQuery,
  onCreate,
  onOpen,
  onWorkspace,
  workspace,
  credit,
  conversations = [],
}: {
  state: AiListState;
  onQuery: (query: string) => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onWorkspace?: () => void;
  workspace?: ReactNode;
  credit?: AiCredit;
  conversations?: readonly AiConversation[];
}): ReactElement {
  const day = credit
    ? Math.max(0, credit.daily - credit.dayUsed) / Math.max(1, credit.daily)
    : 0;
  const week = credit
    ? Math.max(0, credit.weekly - credit.weekUsed) / Math.max(1, credit.weekly)
    : 0;
  return (
    <Pane id="talos-list" className="ai-list" data-testid="ai.list">
      <PaneHeader
        title="AI"
        actions={
          <>
            <IconButton
              label="新对话"
              icon="plus"
              disabledReason={!state.can.ok ? state.can.reason : undefined}
              onClick={onCreate}
            />
            <IconButton label="工作区" icon="folder" onClick={onWorkspace} />
          </>
        }
      />
      <PaneTools>
        <SearchField
          label="搜索标题和标签"
          placeholder="搜索标题和标签"
          value={state.query}
          onChange={(e) => onQuery(e.target.value)}
        />
      </PaneTools>
      <PaneBody>
        {state.error && <StatePanel state="error" hint={state.error} />}
        {!state.items.length ? (
          <StatePanel state={state.emptyState} title={state.emptyTitle} />
        ) : (
          state.items.map((item) => {
            const c = conversations.find((c) => c.id === item.id);
            return (
              <ListRow
                key={item.id}
                title={item.title}
                hint={
                  c
                    ? c.tags.join(" · ") ||
                      new Date(c.updated).toLocaleDateString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                      })
                    : item.hint
                }
                leading={
                  <span className="ai-tile">
                    <Icon name="ai" size={18} />
                  </span>
                }
                titleSuffix={
                  c?.running ? (
                    <Icon name="loading" size={14} spin />
                  ) : undefined
                }
                badge={
                  c ? (
                    <Badge count={Math.max(0, c.lastSeq - c.readSeq)} />
                  ) : undefined
                }
                selected={item.selected}
                onClick={() => onOpen(item.id)}
              />
            );
          })
        )}
      </PaneBody>
      {credit && (
        <footer className="ai-credits">
          <span>
            今日 {Math.round(day * 100)}% · 本周 {Math.round(week * 100)}%
          </span>
          <div className="ai-credit-bars">
            <Progress label="今日剩余额度" value={day} />
            <Progress label="本周剩余额度" value={week} />
          </div>
          <span>
            可用额度 <strong>{(credit.available / 1e6).toFixed(2)}</strong>
          </span>
        </footer>
      )}
      {workspace}
    </Pane>
  );
}
