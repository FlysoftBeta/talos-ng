import { ai } from "@talos/contract";
import type { AiStats, AiCredit } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type {
  RuntimeCommandPort,
  RuntimeQueryPort,
} from "../../../core/runtime-port.ts";
import { call, errorText } from "./commands.ts";

/** Runtime capabilities the billing panel needs. */
export type AiBillingPort = Pick<
  RuntimeCommandPort,
  "can" | "command" | "operation"
> &
  Pick<RuntimeQueryPort, "subscribe">;

export interface BillingUser {
  id: string;
  name: string;
  handle: string;
}
export type BillingField =
  | "daily"
  | "weekly"
  | "days"
  | "query"
  | "user"
  | "amount"
  | "duration"
  | "note";
export interface BillingState {
  can: Capability;
  data: AiStats | undefined;
  error: string;
  daily: string;
  weekly: string;
  days: string;
  query: string;
  users: BillingUser[];
  user: string;
  amount: string;
  duration: string;
  note: string;
  account: AiCredit | undefined;
  busy: boolean;
  /** Idempotency key of the next assignment; renewed whenever an input of it changes. */
  key: string;
}

/** Credit amounts are stored in millionths. */
export const CREDIT_UNIT = 1e6;
export function credits(value: number): string {
  return (value / CREDIT_UNIT).toFixed(2);
}
/** Unrounded credit value, as shown in ledger rows and chart titles. */
export function creditValue(value: number): number {
  return value / CREDIT_UNIT;
}
export function ledgerUser(users: readonly BillingUser[], id: string): string {
  return users.find((u) => u.id === id)?.name ?? "用户";
}
export function toMicro(value: string): number {
  return Math.round(Number(value) * CREDIT_UNIT);
}
export function ledgerKind(kind: string): string {
  return kind === "assignment" ? "分配" : "消耗";
}
export function ledgerNote(entry: { kind: string; note: string }): string {
  return entry.kind === "consumption"
    ? ({ done: "生成完成", cancelled: "已停止", failed: "生成失败" }[
        entry.note
      ] ?? "生成结算")
    : entry.note;
}
export interface ChartBar {
  day: string;
  amount: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Date label (`MM-DD`) shown under every fifth bar and the last one. */
  label: string | undefined;
}
export interface ChartModel {
  ticks: Array<{ y: number; label: string }>;
  bars: ChartBar[];
}
const CHART_DAYS = 30;
/** The 30 consumption days ending at the latest recorded day, scaled for a 600x150 chart. */
export function chartModel(days: AiStats["days"], now: number): ChartModel {
  const top = Math.max(0, ...days.map((v) => v.amount / CREDIT_UNIT)),
    peak = Math.max(1, ...days.map((v) => v.amount)),
    end = days.length ? Date.parse(days[days.length - 1]!.day) : now,
    width = 560 / CHART_DAYS;
  return {
    ticks: [0, 0.5, 1].map((fraction) => ({
      y: 120 - 105 * fraction,
      label: (top * fraction).toFixed(1),
    })),
    bars: Array.from({ length: CHART_DAYS }, (_, i) => {
      const day = new Date(end - (CHART_DAYS - 1 - i) * 86400000)
          .toISOString()
          .slice(0, 10),
        amount = days.find((entry) => entry.day === day)?.amount ?? 0,
        height = (amount / peak) * 110;
      return {
        day,
        amount,
        x: 20 + i * width,
        y: 120 - height,
        width: Math.min(36, width - 4),
        height: Math.max(1, height),
        label: i % 5 === 0 || i === CHART_DAYS - 1 ? day.slice(5) : undefined,
      };
    }),
  };
}

/** Feature-manager billing: quota policy, user lookup, idempotent credit assignment, ledger. */
export class BillingController extends StateStore<BillingState> {
  private cleanup: (() => void) | undefined;
  private seenCan: boolean | undefined;
  constructor(
    private readonly port: AiBillingPort,
    private readonly now: () => number = Date.now,
  ) {
    super({
      can: port.can(ai.admin.stats),
      data: undefined,
      error: "",
      daily: "100",
      weekly: "300",
      days: "30",
      query: "",
      users: [],
      user: "",
      amount: "100",
      duration: "0",
      note: "",
      account: undefined,
      busy: false,
      key: port.operation().op,
    });
  }
  attach(): void {
    this.cleanup = this.port.subscribe(() => this.sync());
    this.sync();
  }
  detach(): void {
    this.cleanup?.();
    this.cleanup = undefined;
  }
  chart(): ChartModel | undefined {
    return this.state.data && chartModel(this.state.data.days, this.now());
  }
  setField = (field: BillingField, value: string): void => {
    const renewsKey =
      field === "amount" ||
      field === "duration" ||
      field === "note" ||
      field === "user";
    this.patch({
      [field]: value,
      ...(renewsKey ? { key: this.port.operation().op } : {}),
      ...(field === "user" ? { account: undefined } : {}),
    } as Partial<BillingState>);
  };
  search = async (): Promise<void> => {
    try {
      this.patch({
        users: await call(this.port, ai.admin.users, {
          query: this.state.query,
        }),
      });
    } catch (e) {
      this.patch({ error: errorText(e) });
    }
  };
  refresh = async (): Promise<void> => {
    try {
      const d = await call(this.port, ai.admin.stats, {});
      this.patch({
        data: d,
        daily: String(d.policy.daily / CREDIT_UNIT),
        weekly: String(d.policy.weekly / CREDIT_UNIT),
        days: String(d.policy.days),
      });
    } catch (e) {
      this.patch({ error: errorText(e) });
    }
  };
  savePolicy = (): void => {
    this.patch({ busy: true });
    void call(this.port, ai.admin.policy, {
      daily: toMicro(this.state.daily),
      weekly: toMicro(this.state.weekly),
      days: Number(this.state.days),
    })
      .then(this.refresh)
      .catch((e) => this.patch({ error: errorText(e) }))
      .finally(() => this.patch({ busy: false }));
  };
  showAccount = (): void => {
    void call(this.port, ai.admin.account, { user: this.state.user })
      .then((account) => this.patch({ account }))
      .catch((e) => this.patch({ error: errorText(e) }));
  };
  assign = (): void => {
    const { user, key, amount, duration, note } = this.state;
    this.patch({ busy: true, error: "" });
    void call(this.port, ai.admin.assign, {
      user,
      key,
      amount: toMicro(amount),
      days: Number(duration),
      note,
    })
      .then((account) => {
        this.patch({ account, key: this.port.operation().op });
        return this.refresh();
      })
      .catch((e) => this.patch({ error: errorText(e) }))
      .finally(() => this.patch({ busy: false }));
  };
  private sync(): void {
    const can = this.port.can(ai.admin.stats);
    this.patch({ can });
    if (can.ok === this.seenCan) return;
    this.seenCan = can.ok;
    if (can.ok) {
      void this.refresh();
      void this.search();
    }
  }
}
