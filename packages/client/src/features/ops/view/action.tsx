import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import type { ButtonVariant } from "../../../ui/actions/button.tsx";
import { ConfirmDialog, Menu } from "../../../ui/overlays/index.ts";
import { Mark, Progress } from "../../../ui/feedback/index.ts";
import { Stack } from "../../../ui/layout/index.ts";
import type { ActionModel } from "../model/actions.ts";
import type { ActionHandlers } from "../model/panel.ts";

function ActionFeedback({
  action,
  handlers,
}: {
  action: ActionModel;
  handlers: ActionHandlers;
}): ReactElement {
  return (
    <>
      {action.busy && (
        <Stack space={2}>
          <Mark state="pending" label="处理中" />
          <Progress label={`${action.label}进度`} />
        </Stack>
      )}
      {action.error && (
        <div role="alert">
          <Mark state="failed" label={action.error} />
        </div>
      )}
      {action.confirm && (
        <ConfirmDialog
          open={action.open}
          objectName={action.confirm}
          onConfirm={() => void handlers.confirm(action.id)}
          onClose={() => handlers.dismiss(action.id)}
        />
      )}
    </>
  );
}

/** One ops control with its permission reason and operation state. */
export function ActionView({
  action,
  handlers,
  variant = "secondary",
}: {
  action: ActionModel;
  handlers: ActionHandlers;
  variant?: ButtonVariant;
}): ReactElement {
  return (
    <Stack className="ops-action" space={2}>
      <Button
        variant={variant}
        icon={action.icon}
        busy={action.busy}
        disabledReason={action.reason}
        onClick={() => void handlers.press(action.id)}
      >
        {action.busy ? "处理中…" : action.label}
      </Button>
      <ActionFeedback action={action} handlers={handlers} />
    </Stack>
  );
}

/** Secondary record actions share a menu while retaining their confirmations. */
export function ActionMenu({
  label,
  actions,
  handlers,
}: {
  label: string;
  actions: readonly ActionModel[];
  handlers: ActionHandlers;
}): ReactElement {
  return (
    <Stack className="ops-action" space={2}>
      <Menu
        label={label}
        items={actions.map((action) => ({
          label: action.label,
          icon: action.icon,
          danger: action.icon === "trash",
          disabledReason: action.reason || (action.busy ? "处理中" : undefined),
          onSelect: () => void handlers.press(action.id),
        }))}
      />
      {actions.map((action) => (
        <ActionFeedback key={action.id} action={action} handlers={handlers} />
      ))}
    </Stack>
  );
}
