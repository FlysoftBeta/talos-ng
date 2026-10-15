import { contract } from "@talos/contract";
import type { AdminDevice, ResultOf } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type { RuntimeQueryPort } from "../../../core/runtime-port.ts";
import {
  PAGE_SIZE,
  QueryResource,
  adminCall,
  failureText,
  sameValue,
} from "./query.ts";
import type { AdminCommandPort, LoadState } from "./query.ts";

export type DevicesPort = AdminCommandPort &
  Pick<RuntimeQueryPort, "subscribe">;
export type DevicePage = ResultOf<typeof contract.admin.device.list>;
export type DevicePolicy = ResultOf<typeof contract.admin.device.policy.get>;
export type IdentitySignal = "clientId" | "userAgent" | "ip";
export const IDENTITY_SIGNALS: ReadonlyArray<
  readonly [IdentitySignal, string]
> = [
  ["clientId", "客户端 ID"],
  ["userAgent", "User-Agent"],
  ["ip", "IP 地址"],
];

/** Device name as shown in confirmations: its note, or its id. */
export const deviceName = (device: AdminDevice): string =>
  device.label || device.id;
export function deviceStatus(device: AdminDevice): string {
  return `${device.persistent ? "已保留" : "临时"} · ${
    device.locked ? "锁定" : device.whitelisted ? "白名单" : "普通"
  }`;
}
/** Signals after toggling one; a policy must always keep at least one. */
export function toggledSignals(
  current: readonly IdentitySignal[],
  signal: IdentitySignal,
): IdentitySignal[] {
  return current.includes(signal)
    ? current.filter((item) => item !== signal)
    : [...current, signal];
}

export interface DevicesState {
  list: LoadState<DevicePage>;
  policy: LoadState<DevicePolicy>;
  access: Capability;
  query: string;
  page: number;
  editing: AdminDevice | undefined;
  label: string;
  boundUser: string;
  confirm: { label: string } | undefined;
  error: string;
}

/** Device registry and identity policy; every change is confirmed or saved from the editor. */
export class DevicesController extends StateStore<DevicesState> {
  private cleanup: (() => void) | undefined;
  private pending: (() => Promise<unknown>) | undefined;
  private readonly list = new QueryResource<DevicePage>((list) =>
    this.patch({ list }),
  );
  private readonly policy = new QueryResource<DevicePolicy>((policy) =>
    this.patch({ policy }),
  );
  constructor(private readonly port: DevicesPort) {
    super({
      list: { data: undefined, loading: true, error: "" },
      policy: { data: undefined, loading: true, error: "" },
      access: port.can(contract.admin.device.list),
      query: "",
      page: 0,
      editing: undefined,
      label: "",
      boundUser: "",
      confirm: undefined,
      error: "",
    });
  }
  attach(): void {
    this.cleanup = this.port.subscribe(() => {
      const access = this.port.can(contract.admin.device.list);
      if (!sameValue(access, this.state.access)) this.patch({ access });
    });
    this.loadList();
    this.policy.run(() =>
      adminCall(this.port, contract.admin.device.policy.get, {}),
    );
  }
  detach(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    this.list.cancel();
    this.policy.cancel();
  }
  refresh = (): void => {
    this.list.reload();
    this.policy.reload();
  };
  setQuery = (query: string): void => {
    this.patch({ query, page: 0 });
    this.loadList();
  };
  setPage = (page: number): void => {
    this.patch({ page });
    this.loadList();
  };

  // Editor
  edit = (device: AdminDevice): void =>
    this.patch({
      editing: device,
      label: device.label,
      boundUser: device.boundUser ?? "",
    });
  closeEditor = (): void => this.patch({ editing: undefined });
  setLabel = (label: string): void => this.patch({ label });
  setBoundUser = (boundUser: string): void => this.patch({ boundUser });
  setWhitelisted = (whitelisted: boolean): void => {
    const { editing } = this.state;
    if (editing) this.patch({ editing: { ...editing, whitelisted } });
  };
  saveEditor = (): void => {
    const { editing: row, label, boundUser } = this.state;
    if (!row) return;
    void adminCall(this.port, contract.admin.device.update, {
      id: row.id,
      label,
      boundUser: boundUser || null,
      whitelisted: row.whitelisted,
    })
      .then(() => {
        this.patch({ editing: undefined });
        this.refresh();
      })
      .catch((failure: unknown) =>
        this.patch({ error: failureText(failure, "保存失败") }),
      );
  };

  // Confirmed commands
  keep = (device: AdminDevice): void =>
    this.ask(`保留设备 ${deviceName(device)}`, () =>
      adminCall(this.port, contract.admin.device.update, {
        id: device.id,
        persistent: true,
      }),
    );
  toggleLock = (device: AdminDevice): void =>
    this.ask(
      `${device.locked ? "解锁" : "锁定"}设备 ${deviceName(device)}`,
      () =>
        adminCall(this.port, contract.admin.device.update, {
          id: device.id,
          locked: !device.locked,
        }),
    );
  remove = (device: AdminDevice): void =>
    this.ask(`删除设备 ${deviceName(device)}，并清除其会话`, () =>
      adminCall(this.port, contract.admin.device.delete, { id: device.id }),
    );
  toggleWhitelist = (): void => {
    const policy = this.state.policy.data;
    if (policy)
      this.ask(`${policy.whitelist ? "关闭" : "启用"}白名单`, () =>
        adminCall(this.port, contract.admin.device.policy.set, {
          whitelist: !policy.whitelist,
        }),
      );
  };
  toggleSignal = (signal: IdentitySignal): void => {
    const next = toggledSignals(
      this.state.policy.data?.identitySignals ?? ["clientId"],
      signal,
    );
    if (!next.length) {
      this.patch({ error: "至少保留一个设备识别信号" });
      return;
    }
    this.ask("设备识别规则", () =>
      adminCall(this.port, contract.admin.device.policy.set, {
        identitySignals: next,
      }),
    );
  };
  dismissConfirm = (): void => {
    this.pending = undefined;
    this.patch({ confirm: undefined });
  };
  runConfirmed = (): void => {
    const task = this.pending;
    this.dismissConfirm();
    void task?.()
      .then(this.refresh)
      .catch((failure: unknown) =>
        this.patch({ error: failureText(failure, "操作失败") }),
      );
  };

  private ask(label: string, run: () => Promise<unknown>): void {
    this.pending = run;
    this.patch({ confirm: { label } });
  }
  private loadList(): void {
    this.list.run(() =>
      adminCall(this.port, contract.admin.device.list, {
        query: this.state.query,
        offset: this.state.page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    );
  }
}
