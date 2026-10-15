import type { Admission } from "../../../core/auth/admission.ts";
import { StateStore } from "../../../core/controller-state.ts";

export const admissionCopy: Record<
  Admission["reason"],
  { title: string; hint: string }
> = {
  "whitelist-required": {
    title: "设备未列入白名单",
    hint: "请将设备 ID 提供给管理员，获准后再试。",
  },
  "bound-to-other-user": {
    title: "设备已绑定其他用户",
    hint: "此设备仅允许绑定的用户登录，请联系管理员调整绑定。",
  },
  banned: { title: "设备或账户已被封禁", hint: "请联系管理员了解封禁原因。" },
  throttled: {
    title: "PIN 尝试次数过多",
    hint: "请等待倒计时结束后再输入 PIN。",
  },
  "invalid-client": {
    title: "设备标识无效",
    hint: "无法确认此设备，请联系管理员并提供下方设备 ID。",
  },
  "system-lock": {
    title: "系统已锁定",
    hint: "管理员已暂停使用，请等待系统解锁。",
  },
  "idle-lock": {
    title: "闲置已锁定",
    hint: "会话因长时间未操作而锁定，请重新输入 PIN。",
  },
};

export interface RetryCountdown {
  /** The countdown line is shown only for throttling and timed bans. */
  visible: boolean;
  seconds: number;
  label: string;
}

export function retryCountdown(
  admission: Admission,
  time: number,
): RetryCountdown {
  const seconds = Math.max(
    0,
    Math.ceil(((admission.retryAt ?? time) - time) / 1000),
  );
  return {
    visible:
      admission.reason === "throttled" ||
      (admission.reason === "banned" && admission.retryAt !== undefined),
    seconds,
    label: seconds > 0 ? `${seconds} 秒后可重试` : "现在可以重试",
  };
}

export interface LogoutState {
  confirming: boolean;
  busy: boolean;
  error: string | undefined;
}

/** Confirmed logout from the denied-session screen. */
export class LogoutController extends StateStore<LogoutState> {
  constructor(private readonly run: () => Promise<void>) {
    super({ confirming: false, busy: false, error: undefined });
  }
  ask = (): void => this.patch({ confirming: true });
  /** A running logout cannot be dismissed. */
  cancel = (): void => {
    if (!this.state.busy) this.patch({ confirming: false });
  };
  confirm = (): void => {
    this.patch({ busy: true, error: undefined });
    void this.run()
      .then(() => this.patch({ confirming: false }))
      .catch((error: unknown) =>
        this.patch({
          error: error instanceof Error ? error.message : "退出未完成，请重试",
        }),
      )
      .finally(() => this.patch({ busy: false }));
  };
}
