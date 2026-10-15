import { contract } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { RuntimeCommandPort } from "../../../core/runtime-port.ts";

export interface Assignment {
  user: string;
  key: string;
  amount: number;
  days: number;
  note: string;
}
export interface AssignmentResult {
  assignment: Assignment;
  ok: boolean;
  error?: string;
}
/** Keep each fingerprint unchanged when a response is lost and the operator retries. */
export async function assignCredits(
  assignments: readonly Assignment[],
  call: (assignment: Assignment) => Promise<unknown>,
): Promise<AssignmentResult[]> {
  const results: AssignmentResult[] = [];
  for (const assignment of assignments) {
    try {
      await call(assignment);
      results.push({ assignment, ok: true });
    } catch (error) {
      results.push({
        assignment,
        ok: false,
        error: error instanceof Error ? error.message : "分配失败",
      });
    }
  }
  return results;
}

export type CreditBatchPort = Pick<RuntimeCommandPort, "command" | "operation">;
export interface CreditBatchState {
  amount: string;
  days: string;
  note: string;
  busy: boolean;
  results: readonly AssignmentResult[] | undefined;
}
/** Credits are entered in whole units and stored in millionths. */
export function creditAmount(input: string): number {
  return Math.round(Number(input) * 1e6);
}
/** A batch needs a non-negative recharge, a plan length within ten years, and at least one of them. */
export function batchValid(state: CreditBatchState): boolean {
  const credits = creditAmount(state.amount);
  const duration = Number(state.days);
  return (
    Number.isSafeInteger(credits) &&
    credits >= 0 &&
    Number.isSafeInteger(duration) &&
    duration >= 0 &&
    duration <= 3650 &&
    (credits > 0 || duration > 0)
  );
}
export function batchSummary(results: readonly AssignmentResult[]): {
  succeeded: number;
  failures: readonly AssignmentResult[];
} {
  const failures = results.filter((result) => !result.ok);
  return { succeeded: results.length - failures.length, failures };
}

/** Assigns AI credit to every selected user; failed items retry with their original keys. */
export class CreditBatchController extends StateStore<CreditBatchState> {
  constructor(
    private readonly port: CreditBatchPort,
    private readonly users: readonly string[],
    private readonly onClose: () => void,
  ) {
    super({
      amount: "0",
      days: "0",
      note: "",
      busy: false,
      results: undefined,
    });
  }
  setAmount = (value: string): void => this.patch({ amount: value });
  setDays = (value: string): void => this.patch({ days: value });
  setNote = (value: string): void => this.patch({ note: value });
  /** The sheet cannot be dismissed while assignments are running. */
  close = (): void => {
    if (!this.state.busy) this.onClose();
  };
  canRun(): boolean {
    const { results } = this.state;
    return (
      !this.state.busy &&
      (results ? !results.every((r) => r.ok) : batchValid(this.state))
    );
  }
  run = async (): Promise<void> => {
    const { busy, results, note } = this.state;
    if (busy || (!results && !batchValid(this.state))) return;
    this.patch({ busy: true });
    const assignments = results
      ? results.filter((r) => !r.ok).map((r) => r.assignment)
      : this.users.map((user) => ({
          user,
          key: this.port.operation().op,
          amount: creditAmount(this.state.amount),
          days: Number(this.state.days),
          note,
        }));
    const next = await assignCredits(assignments, (args) =>
      this.port.command(contract.ai.admin.assign, args),
    );
    this.patch({
      results: [...(results ?? []).filter((r) => r.ok), ...next],
      busy: false,
    });
  };
}
