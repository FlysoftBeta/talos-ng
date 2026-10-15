import { StateStore } from "../../../core/controller-state.ts";
import { actionModel, idleAction, pressAction } from "./actions.ts";
import type {
  ActionDef,
  ActionHost,
  ActionModel,
  ActionState,
  ActionStates,
} from "./actions.ts";
import { opsCapability } from "./port.ts";
import type { OpsPort } from "./port.ts";
import { panelStatus } from "./query.ts";
import type { PanelStatus, QueryState } from "./query.ts";
import type { Method } from "@talos/contract";

export interface OpsPanelState {
  /** Bumped when the runtime snapshot changes, so permission-derived output is re-read. */
  revision: number;
  actions: ActionStates;
}
export const initialPanelState: OpsPanelState = { revision: 0, actions: {} };

export interface PanelFrame {
  title: string;
  hint: string;
  status: PanelStatus;
  /** Why the panel is offline or unauthorised. */
  reason: string | undefined;
  error: string | undefined;
  refresh: ActionModel;
}

interface PrimaryQuery {
  method: Method;
  reload(): void;
}
interface Syncable {
  sync(): void;
  cancel(): void;
}

/** Shared lifecycle of the ops panels: permission-aware queries and the action sequencing. */
export abstract class OpsPanelController<S extends OpsPanelState>
  extends StateStore<S>
  implements ActionHost
{
  private cleanup: (() => void) | undefined;
  private readonly tracked: Syncable[] = [];
  constructor(
    protected readonly port: OpsPort,
    initial: S,
  ) {
    super(initial);
  }
  /** Every action of the panel; ids are stable. */
  protected abstract defs(): ActionDef[];

  protected track<Q extends Syncable>(query: Q): Q {
    this.tracked.push(query);
    return query;
  }
  attach(): void {
    this.cleanup = this.port.subscribe(() => {
      this.tracked.forEach((query) => query.sync());
      this.patch({ revision: this.state.revision + 1 } as Partial<S>);
    });
    this.tracked.forEach((query) => query.sync());
  }
  detach(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    this.tracked.forEach((query) => query.cancel());
  }

  actionStates = (): ActionStates => this.state.actions;
  setActionState = (id: string, value: ActionState): void =>
    this.patch({
      actions: { ...this.state.actions, [id]: value },
    } as Partial<S>);

  action(id: string): ActionModel {
    const def = this.defs().find((entry) => entry.id === id);
    if (!def) throw new Error(`unknown ops action ${id}`);
    return actionModel(this.port, def, this.state.actions[id] ?? idleAction);
  }
  press = (id: string): Promise<void> => this.perform(id, false);
  confirm = (id: string): Promise<void> => this.perform(id, true);
  dismiss = (id: string): void =>
    this.setActionState(id, {
      ...(this.state.actions[id] ?? idleAction),
      open: false,
    });

  private async perform(id: string, confirmed: boolean): Promise<void> {
    const model = this.action(id);
    if (model.reason !== undefined) return;
    await pressAction(
      this,
      this.defs().find((entry) => entry.id === id)!,
      confirmed,
    );
  }

  protected access(method: Method) {
    return opsCapability(this.port, method);
  }
  /** Frame state of a panel whose content depends on one primary query. */
  protected frame(
    title: string,
    hint: string,
    query: PrimaryQuery,
    state: QueryState<unknown>,
  ): PanelFrame {
    const access = this.access(query.method);
    return {
      title,
      hint,
      status: panelStatus(access, state.error, !state.data),
      reason: access.ok ? undefined : access.reason,
      error: state.error,
      refresh: this.action("refresh"),
    };
  }
  protected refreshDef(query: PrimaryQuery): ActionDef {
    return {
      id: "refresh",
      label: "刷新",
      method: query.method,
      run: async () => query.reload(),
    };
  }
}

/** What a view may call on a panel controller to drive its actions. */
export type ActionHandlers = Pick<
  OpsPanelController<OpsPanelState>,
  "press" | "confirm" | "dismiss"
>;
