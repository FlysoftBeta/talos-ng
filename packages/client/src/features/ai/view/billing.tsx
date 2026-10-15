import { useState } from "react";
import type { ReactElement } from "react";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import { Field, SelectField, SearchField } from "../../../ui/inputs/index.ts";
import {
  Inline,
  PaneHeader,
  Group,
  Stack,
  SectionHeader,
} from "../../../ui/layout/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import {
  credits,
  creditValue,
  ledgerKind,
  ledgerNote,
  ledgerUser,
} from "../model/billing.ts";
import type {
  BillingController,
  BillingState,
  ChartModel,
} from "../model/billing.ts";
import { DataGrid } from "../../../ui/data-grid/index.ts";
import { Dialog, Menu } from "../../../ui/overlays/index.ts";
import "./ai.css";

export type BillingActions = Pick<
  BillingController,
  "setField" | "search" | "refresh" | "savePolicy" | "showAccount" | "assign"
>;
export function BillingView({
  state,
  chart,
  actions,
}: {
  state: BillingState;
  chart: ChartModel | undefined;
  actions: BillingActions;
}): ReactElement {
  const { data, account } = state;
  const [assigning, setAssigning] = useState(false);
  if (!state.can.ok)
    return <StatePanel state="offline" hint={state.can.reason} />;
  return (
    <div className="ai-admin" data-testid="ai.billing">
      <PaneHeader
        title="AI 额度与统计"
        actions={
          <IconButton
            label="刷新统计"
            icon="sync"
            onClick={() => void actions.refresh()}
          />
        }
      />
      <Stack className="ai-billing-body" space={5}>
        {state.error && <StatePanel state="error" hint={state.error} />}
        {!data || !chart ? (
          <StatePanel state="loading" />
        ) : (
          <>
            <div className="ai-metrics">
              <p>
                充值余额<strong>{credits(data.topup)}</strong>
              </p>
              <p>
                套餐周额度总量<strong>{credits(data.planStock)}</strong>
              </p>
              <p>
                累计消耗<strong>{credits(data.consumed)}</strong>
              </p>
            </div>
            <section>
              <SectionHeader title="近 30 个消费日" hint="按 UTC 日期统计" />
              <svg
                className="ai-chart"
                data-testid="ai.billing.chart"
                viewBox="0 0 600 150"
                role="img"
                aria-label="每日 AI 额度消耗柱状图"
              >
                <path d="M20 10v110h570" fill="none" stroke="currentColor" />
                {chart.ticks.map((tick, index) => (
                  <text key={tick.y} x="2" y={tick.y} fontSize="14">
                    {(
                      (Math.max(
                        0,
                        ...chart.bars.map((bar) => creditValue(bar.amount)),
                      ) *
                        index) /
                      2
                    ).toLocaleString("zh-CN", { maximumSignificantDigits: 3 })}
                  </text>
                ))}
                {chart.bars.map((bar) => (
                  <g key={bar.day}>
                    <title>
                      {bar.day}：{creditValue(bar.amount)} 额度
                    </title>
                    <rect
                      x={bar.x}
                      y={bar.y}
                      width={bar.width}
                      height={bar.height}
                    />
                    {bar.label !== undefined && (
                      <text x={bar.x} y="140" fontSize="14">
                        {bar.label}
                      </text>
                    )}
                  </g>
                ))}
              </svg>
            </section>
            <Group
              title="套餐策略"
              hint="每天与每周一 UTC 00:00 重置，两个窗口共同限制套餐消耗。"
            >
              <Stack className="ai-policy">
                <Field
                  label="每日额度"
                  type="number"
                  min="0"
                  value={state.daily}
                  onChange={(e) => actions.setField("daily", e.target.value)}
                />
                <Field
                  label="每周额度"
                  type="number"
                  min="0"
                  value={state.weekly}
                  onChange={(e) => actions.setField("weekly", e.target.value)}
                />
                <Field
                  label="默认套餐天数"
                  type="number"
                  min="1"
                  value={state.days}
                  onChange={(e) => actions.setField("days", e.target.value)}
                />
                <Inline>
                  <Button
                    variant="primary"
                    busy={state.busy}
                    onClick={actions.savePolicy}
                  >
                    保存套餐策略
                  </Button>
                </Inline>
              </Stack>
            </Group>
            <section>
              <SectionHeader title="用户充值与套餐" />
              <Inline>
                <SearchField
                  label="搜索用户姓名或账号"
                  placeholder="搜索用户姓名或账号"
                  value={state.query}
                  onChange={(e) => actions.setField("query", e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void actions.search();
                  }}
                />
                <Button onClick={() => void actions.search()}>查找用户</Button>
              </Inline>
              <DataGrid
                ariaLabel="AI 额度账户"
                rows={state.users}
                rowKey={(u) => u.id}
                height={Math.min(264, Math.max(44, state.users.length * 44))}
                columns={[
                  {
                    id: "name",
                    label: "姓名",
                    width: 160,
                    render: (u) => u.name,
                  },
                  {
                    id: "handle",
                    label: "账号",
                    width: 160,
                    render: (u) => u.handle,
                  },
                  {
                    id: "actions",
                    label: "操作",
                    width: 80,
                    render: (u) => (
                      <Menu
                        label={`管理额度：${u.name}`}
                        items={[
                          {
                            label: "查看用户额度",
                            onSelect: () => {
                              actions.setField("user", u.id);
                              actions.showAccount();
                            },
                          },
                          {
                            label: "分配额度",
                            onSelect: () => {
                              actions.setField("user", u.id);
                              setAssigning(true);
                            },
                          },
                        ]}
                      />
                    ),
                  },
                ]}
              />
              {account && (
                <p role="status">
                  用户可用额度：{credits(account.available)}；充值余额：
                  {credits(account.topup)}
                </p>
              )}
            </section>
            <section>
              <SectionHeader title="最近流水" />
              <DataGrid
                ariaLabel="AI 额度流水"
                rows={data.ledger}
                rowKey={(l) => l.id}
                height={264}
                columns={[
                  {
                    id: "user",
                    label: "用户",
                    width: 104,
                    render: (l) => ledgerUser(state.users, l.user),
                  },
                  {
                    id: "kind",
                    label: "类型",
                    width: 64,
                    render: (l) => ledgerKind(l.kind),
                  },
                  {
                    id: "amount",
                    label: "额度",
                    width: 112,
                    render: (l) => creditValue(l.amount),
                  },
                  {
                    id: "note",
                    label: "备注",
                    width: 200,
                    render: (l) => ledgerNote(l),
                    longText: (l) => ledgerNote(l),
                  },
                ]}
              />
            </section>
          </>
        )}
      </Stack>
      <Dialog
        open={assigning}
        title="分配额度"
        onClose={() => setAssigning(false)}
        footer={
          <>
            <Button onClick={() => setAssigning(false)}>取消</Button>
            <Button
              variant="primary"
              busy={state.busy}
              disabledReason={!state.user ? "请先选择用户" : undefined}
              onClick={actions.assign}
            >
              分配额度
            </Button>
          </>
        }
      >
        <Stack>
          {state.error && <StatePanel state="error" hint={state.error} />}
          <SelectField
            label="用户"
            value={state.user}
            onChange={(e) => actions.setField("user", e.target.value)}
          >
            <option value="">请选择用户</option>
            {state.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}（{u.handle}）
              </option>
            ))}
          </SelectField>
          <Field
            label="充值额度"
            type="number"
            min="0"
            value={state.amount}
            onChange={(e) => actions.setField("amount", e.target.value)}
          />
          <Field
            label="套餐天数（0 为不分配）"
            type="number"
            min="0"
            value={state.duration}
            onChange={(e) => actions.setField("duration", e.target.value)}
          />
          <Field
            label="充值备注"
            value={state.note}
            onChange={(e) => actions.setField("note", e.target.value)}
          />
          {account && (
            <p role="status">
              用户可用额度：{credits(account.available)}；充值余额：
              {credits(account.topup)}
            </p>
          )}
        </Stack>
      </Dialog>
    </div>
  );
}
