import type { Method } from "@talos/contract";
import { failureText, opsCapability } from "./port.ts";
import type { OpsPort } from "./port.ts";

export type ActionIcon = "trash" | "download" | "loading" | "edit";

export interface ActionDef {
  id: string;
  label: string;
  method: Method;
  run: () => Promise<unknown>;
  /** Names the object in a confirmation dialog; absent runs immediately. */
  confirm?: string;
  /** Why the action is unavailable although permitted. */
  disabled?: string;
}
export interface ActionState {
  busy: boolean;
  open: boolean;
  error: string | undefined;
}
export interface ActionModel {
  id: string;
  label: string;
  icon: ActionIcon;
  /** Unavailability reason (permission first, then the action's own); undefined when usable. */
  reason: string | undefined;
  busy: boolean;
  open: boolean;
  error: string | undefined;
  confirm: string | undefined;
}
export const idleAction: ActionState = {
  busy: false,
  open: false,
  error: undefined,
};

/** The icon is chosen from the action's wording. */
export function actionIcon(label: string): ActionIcon {
  return /删除|清理|移除/.test(label)
    ? "trash"
    : /下载|备份/.test(label)
      ? "download"
      : /刷新|检查/.test(label)
        ? "loading"
        : "edit";
}

export function actionModel(
  port: OpsPort,
  def: ActionDef,
  state: ActionState = idleAction,
): ActionModel {
  const can = opsCapability(port, def.method);
  return {
    id: def.id,
    label: def.label,
    icon: actionIcon(def.label),
    reason: !can.ok ? can.reason : def.disabled,
    busy: state.busy,
    open: state.open,
    error: state.error,
    confirm: def.confirm,
  };
}

/** Request, confirm and execute sequencing shared by every ops control. */
export type ActionStates = Readonly<Record<string, ActionState>>;
export interface ActionHost {
  actionStates(): ActionStates;
  setActionState(id: string, state: ActionState): void;
}

export async function pressAction(
  host: ActionHost,
  def: ActionDef,
  confirmed: boolean,
): Promise<void> {
  const current = host.actionStates()[def.id] ?? idleAction;
  if (current.busy) return;
  if (def.confirm && !confirmed) {
    host.setActionState(def.id, { ...current, open: true });
    return;
  }
  host.setActionState(def.id, { busy: true, open: false, error: undefined });
  let error: string | undefined;
  try {
    await def.run();
  } catch (failure) {
    error = failureText(failure, "操作失败，请重试");
  }
  host.setActionState(def.id, { busy: false, open: false, error });
}
