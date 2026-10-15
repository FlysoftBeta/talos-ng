import type { AppErrorJSON, CancellationSignal } from "@talos/base";
import type { Db } from "../persistence/db.ts";
import type { Uow } from "../persistence/uow.ts";

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";
export interface Job {
  id: string;
  kind: string;
  owner: string;
  payload: unknown;
  state: JobState;
  progress: number;
  message: string;
  result: unknown;
  error: AppErrorJSON | null;
  attempts: number;
  runAfter: number;
  created: number;
  updated: number;
  rev: number;
  deleted: boolean;
}
export interface JobContext {
  readonly id: string;
  readonly owner: string;
  readonly payload: unknown;
  readonly signal: CancellationSignal;
  progress(value: number, message?: string): void;
}
export interface JobKind {
  concurrency: number;
  timeoutMs: number;
  onBoot: "requeue" | "fail";
  /** Opt in only when repeating the same payload is safe. */
  retryable?: boolean;
  run(context: JobContext): Promise<unknown> | unknown;
}
export interface JobTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface JobsOptions {
  db: Db;
  uow: Uow;
  clock(): number;
  id(): string;
  timers?: JobTimers;
  progressIntervalMs?: number;
  assertOwnerWritable?(owner: string): void;
  reportError?(error: unknown): void;
}
