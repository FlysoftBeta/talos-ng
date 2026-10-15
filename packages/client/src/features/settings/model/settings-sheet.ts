import { AppError } from "@talos/base";
import { contract } from "@talos/contract";
import type {
  RuntimeCommandPort,
  RuntimeLifecyclePort,
  RuntimeSessionPort,
  RuntimeSettingsPort,
  RuntimeStatusPort,
} from "../../../core/runtime-port.ts";
import { preferenceValue } from "./preferences.ts";
import { StateStore } from "../../../core/controller-state.ts";

export type SettingsSubSheet = "about" | "pins" | "reset" | "logout";
export interface SettingsState {
  sheet: SettingsSubSheet | undefined;
  busy: boolean;
  error: string | undefined;
  /** Count of unsynchronised operations, read once when the reset dialog opens. */
  allOperations: number | undefined;
}
export type SettingsPort = Pick<RuntimeCommandPort, "can"> &
  Pick<RuntimeSettingsPort, "setSetting"> &
  Pick<RuntimeStatusPort, "estimateStorage"> &
  Pick<RuntimeLifecyclePort, "localOperationCount" | "resetLocalData"> &
  Pick<RuntimeSessionPort, "logout">;

export interface ConfirmDialog {
  title: string;
  body: string;
  /** Data-loss warning; only for reset. */
  warning: string | undefined;
  confirmLabel: string;
}
export function confirmDialog(
  kind: "reset" | "logout",
  accountName: string | undefined,
  busy: boolean,
  unsynced: number,
): ConfirmDialog {
  const reset = kind === "reset";
  return {
    title: reset
      ? "重置此设备的本机数据？"
      : `退出「${accountName ?? "当前账号"}」？`,
    body: reset
      ? "将清除本机登录状态、缓存和离线数据，保留设备 ID、已安装的应用与服务器数据。"
      : "将结束服务器会话并移除本机离线解锁凭据，缓存内容保留。",
    warning:
      reset && unsynced > 0
        ? `本机有 ${unsynced} 项尚未同步的操作，重置后将永久丢失。`
        : undefined,
    confirmLabel: busy
      ? "正在处理…"
      : reset
        ? "确认重置本机数据"
        : "确认退出登录",
  };
}

export interface AboutInput {
  build: string;
  device: string | undefined;
  storage: string;
  origin: string;
  userAgent: string;
}
export const aboutRows = (about: AboutInput) => [
  { label: "当前版本", value: about.build },
  { label: "设备 ID", value: about.device ?? "未登记" },
  { label: "服务器地址", value: about.origin },
  { label: "存储使用", value: about.storage },
  { label: "浏览器", value: about.userAgent },
];

/** Preference saving and the about / PIN / reset / logout sub-flows. */
export class SettingsController extends StateStore<SettingsState> {
  constructor(private readonly port: SettingsPort) {
    super({
      sheet: undefined,
      busy: false,
      error: undefined,
      allOperations: undefined,
    });
  }
  /** `option` is the chosen option's value; the stored value shape is the model's concern. */
  choose = (key: string, option: string): void => {
    if (!this.port.can(contract.me.setting.set).ok) return;
    this.patch({ error: undefined });
    void this.port
      .setSetting(key, preferenceValue(key, option))
      .catch(() => this.patch({ error: "无法保存更改，请重试" }));
  };
  openPins = (): void => this.patch({ sheet: "pins" });
  openLogout = (): void => this.patch({ sheet: "logout" });
  openAbout = (): void => {
    void this.port.estimateStorage();
    this.patch({ sheet: "about" });
  };
  openReset = (): void => {
    void this.port
      .localOperationCount()
      .then((count) => this.patch({ allOperations: count, sheet: "reset" }))
      .catch(() => this.patch({ error: "无法读取待同步操作，请重试" }));
  };
  close = (): void => this.patch({ sheet: undefined });
  /** The confirmation dialog cannot be dismissed while its action runs. */
  dismissConfirmation = (): void => {
    if (!this.state.busy) this.close();
  };
  confirm = async (): Promise<void> => {
    const kind = this.state.sheet;
    this.patch({ busy: true, error: undefined });
    try {
      if (kind === "reset")
        await this.port.resetLocalData(() =>
          this.patch({ error: "请关闭其他 Talos II 标签页，重置会自动继续。" }),
        );
      else await this.port.logout();
      this.patch({ sheet: undefined });
    } catch (error) {
      this.patch({
        error: error instanceof AppError ? error.message : "操作未完成，请重试",
      });
    } finally {
      this.patch({ busy: false });
    }
  };
}
