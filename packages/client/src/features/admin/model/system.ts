import { contract } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type { RuntimeQueryPort } from "../../../core/runtime-port.ts";
import { holdsRole } from "./access.ts";
import type { AdminActor } from "./access.ts";
import { QueryResource, adminCall, failureText, sameValue } from "./query.ts";
import type { AdminCommandPort, LoadState } from "./query.ts";

export type SystemPort = AdminCommandPort &
  Pick<RuntimeQueryPort, "getSnapshot" | "subscribe">;
export type SystemSettings =
  | ResultOf<typeof contract.admin.settings.get>
  | ResultOf<typeof contract.admin.device.policy.get>;
export type SystemSwitch = "whitelist" | "systemLock" | "idleLock";

/** Access managers see device policy switches; community managers see media policy. */
export interface SystemAccess {
  policy: boolean;
  media: boolean;
  permission: Capability;
}
export function systemAccess(
  actor: AdminActor | undefined,
  can: AdminCommandPort["can"],
): SystemAccess {
  const media = holdsRole(actor, "community_manager");
  return {
    policy: holdsRole(actor, "access_manager"),
    media,
    permission: can(
      media ? contract.admin.settings.get : contract.admin.device.policy.get,
    ),
  };
}
/** Confirmation text and button wording per switch, derived from its current value. */
export function switchLabel(field: SystemSwitch, on: boolean): string {
  return {
    whitelist: `${on ? "关闭" : "启用"}设备白名单`,
    systemLock: `${on ? "解除" : "启用"}系统锁`,
    idleLock: `${on ? "关闭" : "启用"}闲置锁`,
  }[field];
}

export interface SystemState {
  access: SystemAccess;
  data: LoadState<SystemSettings>;
  error: string;
  confirm: { label: string } | undefined;
  maxVolume: number;
}

/** Device and media policy switches; each change is confirmed and reloads the settings. */
export class SystemController extends StateStore<SystemState> {
  private cleanup: (() => void) | undefined;
  private pending: (() => Promise<unknown>) | undefined;
  private readonly data = new QueryResource<SystemSettings>((data) =>
    this.patch({ data }),
  );
  constructor(private readonly port: SystemPort) {
    super({
      access: systemAccess(port.getSnapshot().user, port.can),
      data: { data: undefined, loading: true, error: "" },
      error: "",
      confirm: undefined,
      maxVolume: 1,
    });
  }
  attach(): void {
    this.cleanup = this.port.subscribe(() => {
      const access = systemAccess(this.port.getSnapshot().user, (m) =>
        this.port.can(m),
      );
      if (sameValue(access, this.state.access)) return;
      const mediaChanged = access.media !== this.state.access.media;
      this.patch({ access });
      if (mediaChanged) this.load();
    });
    this.load();
  }
  detach(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    this.data.cancel();
  }
  reload = (): void => this.data.reload();
  setMaxVolume = (maxVolume: number): void => this.patch({ maxVolume });
  toggle = (field: SystemSwitch): void => {
    const settings = this.state.data.data;
    if (settings)
      this.ask(switchLabel(field, settings[field]), () =>
        adminCall(this.port, contract.admin.device.policy.set, {
          [field]: !settings[field],
        }),
      );
  };
  saveMedia = (): void => {
    const { maxVolume } = this.state;
    this.ask("媒体服务设置", () =>
      adminCall(this.port, contract.admin.settings.set, {
        maxVolume,
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
      .then(this.data.reload)
      .catch((failure: unknown) =>
        this.patch({ error: failureText(failure, "操作失败，请重试") }),
      );
  };

  private ask(label: string, run: () => Promise<unknown>): void {
    this.pending = run;
    this.patch({ confirm: { label } });
  }
  private load(): void {
    this.data.run(() =>
      this.state.access.media
        ? adminCall(this.port, contract.admin.settings.get, {})
        : adminCall(this.port, contract.admin.device.policy.get, {}),
    );
  }
}
