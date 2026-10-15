import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "../../ui/actions/index.ts";
import { ConfirmDialog, Menu, Sheet } from "../../ui/overlays/index.ts";
import { Checkbox, SearchField, SelectField } from "../../ui/inputs/index.ts";
import { ListRow, OfflineHint, StatePanel } from "../../ui/feedback/index.ts";
import { Avatar, Group, Tag } from "../../ui/layout/index.ts";
import { Segmented } from "../../ui/navigation/index.ts";
import {
  filterPrincipals,
  levelLabels,
  principalKey,
  principalName,
  principalOptionLabel,
} from "./model.ts";
import type { GrantLevel, GrantState, Principal, ShareGrant } from "./model.ts";
import "./sharing.css";

const levels: readonly { value: GrantLevel; label: string }[] = [
  { value: "read", label: "读" },
  { value: "write", label: "写" },
  { value: "own", label: "管理" },
];
export function PrincipalPicker({
  principals,
  value,
  onChange,
}: {
  principals: readonly Principal[];
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  return (
    <div className="share-picker">
      {principals.length > 6 && (
        <SearchField
          label="查找用户或群组"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <SelectField
        label="分享给"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">选择用户或群组</option>
        {filterPrincipals(principals, query).map((p) => (
          <option key={principalKey(p)} value={principalKey(p)}>
            {principalOptionLabel(p)}
          </option>
        ))}
      </SelectField>
    </div>
  );
}
export function GrantSheetView({
  title,
  reason,
  state,
  onClose,
  onRetry,
  onSelect,
  onLevel,
  onDelegate,
  onGrant,
  onChangeLevel,
  onAskRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: {
  title: string;
  reason?: string;
  state: GrantState;
  onClose(): void;
  onRetry(): void;
  onSelect(value: string): void;
  onLevel(value: GrantLevel): void;
  onDelegate(value: boolean): void;
  onGrant(): void;
  /** Re-grants an existing principal at another level. */
  onChangeLevel?(grant: ShareGrant, level: GrantLevel): void;
  onAskRevoke(grant: ShareGrant): void;
  onCancelRevoke(): void;
  onConfirmRevoke(): void;
}): ReactElement {
  const { principals, grants, canShare, busy, revoke } = state;
  const rowReason = reason || (busy ? "正在保存" : undefined);
  return (
    <Sheet
      open
      title="分享"
      subtitle={title}
      onClose={onClose}
      footer={
        canShare && !state.loading && !state.error ? (
          <OfflineHint label="添加" reason={reason}>
            <Button
              variant="primary"
              busy={busy}
              disabled={!state.selected}
              onClick={onGrant}
            >
              添加
            </Button>
          </OfflineHint>
        ) : undefined
      }
    >
      {state.loading ? (
        <StatePanel state="loading" />
      ) : state.error ? (
        <StatePanel
          state={reason ? "offline" : "error"}
          hint={state.error}
          action={
            <Button variant="secondary" onClick={onRetry}>
              重试
            </Button>
          }
        />
      ) : (
        <>
          <section className="share-section">
            <h3 className="share-heading">有权访问</h3>
            {!grants.length ? (
              <StatePanel
                compact
                state="empty"
                title="尚未分享"
                hint="只有你可以查看"
              />
            ) : (
              <div className="share-grants">
                {grants.map((grant) => {
                  const name = principalName(principals, grant);
                  return (
                    <ListRow
                      key={grant.id}
                      title={name}
                      hint={
                        grant.principalType === "group"
                          ? `群组${grant.delegate ? " · 可转授" : ""}`
                          : `用户${grant.delegate ? " · 可转授" : ""}`
                      }
                      leading={<Avatar name={name} />}
                      trailing={
                        <>
                          <Tag
                            tone={grant.level === "own" ? "accent" : undefined}
                          >
                            {levelLabels[grant.level]}
                          </Tag>
                          {canShare && (
                            <Menu
                              label={`更多操作 ${name}`}
                              size="small"
                              items={[
                                ...levels.map((level) => ({
                                  label: levelLabels[level.value],
                                  checked: grant.level === level.value,
                                  hidden:
                                    !onChangeLevel ||
                                    !principals.some(
                                      (p) =>
                                        p.id === grant.principal &&
                                        p.type === grant.principalType,
                                    ),
                                  disabledReason: rowReason,
                                  onSelect: () =>
                                    onChangeLevel?.(grant, level.value),
                                })),
                                {
                                  label: "撤销访问",
                                  icon: "close" as const,
                                  danger: true,
                                  disabledReason: rowReason,
                                  onSelect: () => onAskRevoke(grant),
                                },
                              ]}
                            />
                          )}
                        </>
                      }
                    />
                  );
                })}
              </div>
            )}
          </section>
          {canShare && (
            <Group title="添加成员" className="share-add">
              <OfflineHint label="添加成员" reason={reason} block>
                <div className="share-form">
                  <PrincipalPicker
                    principals={principals}
                    value={state.selected}
                    onChange={onSelect}
                  />
                  <div className="share-level">
                    <span className="field-label">权限</span>
                    <Segmented
                      label="权限"
                      block
                      value={state.level}
                      options={levels}
                      onChange={onLevel}
                    />
                  </div>
                  <Checkbox
                    label="可转授"
                    hint="对方可以把同级及以下的权限分享给别人"
                    checked={state.delegate}
                    onChange={(e) => onDelegate(e.target.checked)}
                  />
                </div>
              </OfflineHint>
            </Group>
          )}
        </>
      )}
      {revoke && (
        <ConfirmDialog
          open
          title={`撤销「${principalName(principals, revoke)}」的访问？`}
          objectName={principalName(principals, revoke)}
          message={`对方将无法再打开「${title}」。`}
          confirmLabel="撤销访问"
          destructive
          onClose={onCancelRevoke}
          onConfirm={onConfirmRevoke}
        />
      )}
    </Sheet>
  );
}
