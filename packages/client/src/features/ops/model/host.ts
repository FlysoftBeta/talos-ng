import { contract } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import type { ActionDef, ActionModel } from "./actions.ts";
import { OpsPanelController, initialPanelState } from "./panel.ts";
import type { OpsPanelState, PanelFrame } from "./panel.ts";
import { opsCall } from "./port.ts";
import type { OpsPort } from "./port.ts";
import { OpsQuery, emptyQuery } from "./query.ts";
import type { QueryState } from "./query.ts";

const ops = contract.ops;
export type HostStatus = ResultOf<typeof ops.host.status>;
export interface HostState extends OpsPanelState {
  status: QueryState<HostStatus>;
}
export interface HostModel {
  frame: PanelFrame;
  /** Platform line; undefined until the status is known. */
  platform: string | undefined;
  actions: ActionModel[];
}
const WINDOWS_ONLY = "仅支持 Windows";

/** Privileged actions on the computer running the server. */
export class HostController extends OpsPanelController<HostState> {
  private readonly status = this.track(
    new OpsQuery(this.port, ops.host.status, {}, (status) =>
      this.patch({ status }),
    ),
  );
  constructor(port: OpsPort) {
    super(port, { ...initialPanelState, status: emptyQuery() });
  }
  protected defs(): ActionDef[] {
    const disabled = this.state.status.data?.available
      ? undefined
      : WINDOWS_ONLY;
    return [
      this.refreshDef(this.status),
      {
        id: "kill-wps",
        label: "关闭 WPS",
        method: ops.host.run,
        disabled,
        confirm: "关闭服务器上的所有 WPS 文档",
        run: () => opsCall(this.port, ops.host.run, { action: "kill-wps" }),
      },
      {
        id: "shutdown",
        label: "关闭计算机",
        method: ops.host.run,
        disabled,
        confirm: "关闭服务器计算机（10 秒后关机）",
        run: () => opsCall(this.port, ops.host.run, { action: "shutdown" }),
      },
    ];
  }
  model(): HostModel {
    const { status } = this.state;
    return {
      frame: this.frame(
        "主机工具",
        "操作服务器所在的计算机。关闭 WPS 前请保存文档，关机将中断所有连接。",
        this.status,
        status,
      ),
      platform: status.data
        ? status.data.available
          ? "Windows · 可用"
          : "此平台不支持"
        : undefined,
      actions: [this.action("kill-wps"), this.action("shutdown")],
    };
  }
}
