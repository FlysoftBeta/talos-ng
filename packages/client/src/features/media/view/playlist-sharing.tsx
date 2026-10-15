import type { ReactElement } from "react";
import type {
  GrantState,
  GrantLevel,
  ShareGrant,
} from "../../sharing/model.ts";
import { PrincipalPicker } from "../../sharing/index.ts";
import { Button } from "../../../ui/actions/index.ts";
import { Sheet, ConfirmDialog } from "../../../ui/overlays/index.ts";
import { SelectField } from "../../../ui/inputs/index.ts";
import { ListRow, StatePanel } from "../../../ui/feedback/index.ts";

const levels: Record<GrantLevel, string> = {
  read: "可查看",
  write: "可编辑",
  own: "可管理",
};
export function PlaylistSharingView(p: {
  title: string;
  state: GrantState;
  onClose(): void;
  onRetry(): void;
  onSelect(value: string): void;
  onLevel(value: GrantLevel): void;
  onGrant(): void;
  onRevoke(value: ShareGrant): void;
  onCancel(): void;
  onConfirm(): void;
}): ReactElement {
  const { state } = p;
  const name = (g: ShareGrant) =>
    state.principals.find(
      (v) => v.id === g.principal && v.type === g.principalType,
    )?.name ?? g.principal;
  return (
    <Sheet
      open
      title="分享"
      subtitle={p.title}
      onClose={p.onClose}
      footer={
        state.canShare && (
          <Button
            variant="primary"
            busy={state.busy}
            disabled={!state.selected}
            onClick={p.onGrant}
          >
            保存权限
          </Button>
        )
      }
    >
      {state.loading ? (
        <StatePanel state="loading" />
      ) : state.error ? (
        <StatePanel
          state="error"
          hint={state.error}
          action={<Button onClick={p.onRetry}>重试</Button>}
        />
      ) : (
        <>
          <p>
            可以从有权访问的歌单复制曲目。成员可分享同级及以下权限，管理者可撤销访问。
          </p>
          {state.grants.map((g) => (
            <ListRow
              key={g.id}
              title={name(g)}
              hint={levels[g.level]}
              trailing={
                state.canShare && (
                  <Button disabled={state.busy} onClick={() => p.onRevoke(g)}>
                    撤销访问
                  </Button>
                )
              }
            />
          ))}
          {state.canShare && (
            <>
              <PrincipalPicker
                principals={state.principals}
                value={state.selected}
                onChange={p.onSelect}
              />
              <SelectField
                label="权限"
                value={state.level}
                onChange={(e) => p.onLevel(e.target.value as GrantLevel)}
              >
                {(["read", "write", "own"] as const).map((level) => (
                  <option key={level} value={level}>
                    {levels[level]}
                  </option>
                ))}
              </SelectField>
            </>
          )}
        </>
      )}
      {state.revoke && (
        <ConfirmDialog
          open
          objectName={name(state.revoke)}
          message={`对方将无法再打开「${p.title}」。已复制到其他歌单的曲目仍可访问。`}
          destructive
          confirmLabel="撤销访问"
          onClose={p.onCancel}
          onConfirm={p.onConfirm}
        />
      )}
    </Sheet>
  );
}
