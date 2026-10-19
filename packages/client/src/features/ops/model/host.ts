import { contract, SHUTDOWN_MAX_MINUTES } from "@talos/contract";
import type { ArgsOf, ResultOf } from "@talos/contract";
import type { ActionDef, ActionModel } from "./actions.ts";
import { dateTimeText } from "./format.ts";
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
  /** Scheduled shutdown delay being chosen, in minutes. */
  delay: number;
}
export interface HostModel {
  frame: PanelFrame;
  /** Platform line; undefined until the status is known. */
  platform: string | undefined;
  /** The pending shutdown this server scheduled, as text. */
  scheduled: string | undefined;
  delay: number;
  maxDelay: number;
  reset: ActionModel;
  shutdown: ActionModel;
  schedule: ActionModel;
  cancel: ActionModel;
}
const WINDOWS_ONLY = "仅支持 Windows";

/** "1 小时 30 分钟" for a delay in minutes. */
export function delayText(minutes: number): string {
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return [hours ? `${hours} 小时` : "", rest || !hours ? `${rest} 分钟` : ""]
    .filter(Boolean)
    .join(" ");
}

/** Privileged actions on the computer running the server. */
export class HostController extends OpsPanelController<HostState> {
  private readonly status = this.track(
    new OpsQuery(this.port, ops.host.status, {}, (status) =>
      this.patch({ status }),
    ),
  );
  constructor(port: OpsPort) {
    super(port, { ...initialPanelState, status: emptyQuery(), delay: 30 });
  }
  setDelay = (delay: number): void => this.patch({ delay });
  /** Runs a host command; its answer is the new status. */
  private run(args: ArgsOf<typeof ops.host.run>) {
    return async () => {
      const status = await opsCall(this.port, ops.host.run, args);
      this.patch({ status: { data: status, error: undefined } });
    };
  }
  protected defs(): ActionDef[] {
    const status = this.state.status.data;
    const disabled = status?.available ? undefined : WINDOWS_ONLY;
    const { delay } = this.state;
    return [
      this.refreshDef(this.status),
      {
        id: "reset-classroom",
        label: "重置教学环境",
        method: ops.host.run,
        disabled,
        confirm:
          "关闭服务器上打开的文件夹、Office、WPS、希沃白板和视频展台（未保存的内容会丢失）",
        run: this.run({ action: "reset-classroom" }),
      },
      {
        id: "shutdown",
        label: "立即关机",
        method: ops.host.run,
        disabled,
        confirm: "关闭服务器计算机（10 秒后关机）",
        run: this.run({ action: "shutdown", delayMinutes: 0 }),
      },
      {
        id: "schedule",
        label: "定时关机",
        method: ops.host.run,
        disabled: disabled ?? (delay < 1 ? "请选择关机时间" : undefined),
        confirm: `在 ${delayText(delay)}后关闭服务器计算机`,
        run: this.run({ action: "shutdown", delayMinutes: delay }),
      },
      {
        id: "cancel",
        label: "取消定时关机",
        method: ops.host.run,
        disabled:
          disabled ?? (status?.shutdownAt ? undefined : "没有待执行的关机"),
        run: this.run({ action: "cancel-shutdown" }),
      },
    ];
  }
  model(): HostModel {
    const { status, delay } = this.state;
    return {
      frame: this.frame(
        "主机工具",
        "操作服务器所在的计算机。重置教学环境前请保存文档，关机将中断所有连接。",
        this.status,
        status,
      ),
      platform: status.data
        ? status.data.available
          ? "Windows · 可用"
          : "此平台不支持"
        : undefined,
      scheduled: status.data?.shutdownAt
        ? `将于 ${dateTimeText(status.data.shutdownAt)} 关机`
        : undefined,
      delay,
      maxDelay: SHUTDOWN_MAX_MINUTES,
      reset: this.action("reset-classroom"),
      shutdown: this.action("shutdown"),
      schedule: this.action("schedule"),
      cancel: this.action("cancel"),
    };
  }
}
