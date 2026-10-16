import { AppError } from "@talos/base";
import type { OutboxItem, Row } from "@talos/sync";
import type { StoredRow } from "./db.ts";
export interface ProjectionContext {
  readonly user: string;
  readonly op: string;
}
export interface ClientModule {
  readonly id: string;
  readonly operationTitles?: Readonly<Record<string, string>>;
  /** Outstanding prerequisite operations needed before this queued intent can run. */
  readonly dependencies?: (
    method: string,
    args: unknown,
    outbox: readonly OutboxItem[],
  ) => readonly string[];
  /** Operations sharing a key retain FIFO barriers, including failed writes. */
  readonly orderKey?: (method: string, args: unknown) => string;
  /**
   * Order-irrelevant state upserts by method. They bypass the order key, a pending
   * write merges with a later one to the same register (latest value wins), and
   * debounced writes wait so bursts of edits travel as one.
   */
  readonly registers?: Readonly<Record<string, RegisterWrite>>;
  readonly rowTypes: readonly string[];
  readonly windowed?: Readonly<Record<string, { seqOf(row: Row): number }>>;
  readonly reducers: Readonly<
    Record<
      string,
      (
        rows: readonly StoredRow[],
        args: unknown,
        context: ProjectionContext,
      ) => readonly StoredRow[]
    >
  >;
  readonly repositories: Readonly<
    Record<string, (rows: readonly StoredRow[]) => readonly StoredRow[]>
  >;
}
export interface RegisterWrite {
  /** The register written, or undefined to keep this call strictly ordered. */
  key(args: unknown): string | undefined;
  /** Arguments equivalent to applying `earlier` then `later`; default `later`. */
  merge?(earlier: unknown, later: unknown): unknown;
  /** Quiet period before sending; continuous edits still send within four times it. */
  debounceMs?(args: unknown): number;
}
export function defineClientModule<M extends ClientModule>(module: M): M {
  return Object.freeze(module);
}
export class ModuleRegistry {
  constructor(readonly modules: readonly ClientModule[]) {
    const ids = new Set<string>();
    const methods = new Set<string>();
    for (const module of modules) {
      if (ids.has(module.id)) throw new AppError("E_CONFLICT", "模块重复注册");
      ids.add(module.id);
      for (const method of Object.keys(module.reducers)) {
        if (methods.has(method))
          throw new AppError("E_CONFLICT", "操作重复注册");
        methods.add(method);
      }
    }
  }
  get windowed(): Readonly<Record<string, { seqOf(row: Row): number }>> {
    return Object.assign(
      {},
      ...this.modules.map((module) => module.windowed ?? {}),
    ) as Record<string, { seqOf(row: Row): number }>;
  }
  dependencies(
    method: string,
    args: unknown,
    outbox: readonly OutboxItem[],
  ): readonly string[] {
    return (
      this.modules
        .find((entry) => entry.reducers[method])
        ?.dependencies?.(method, args, outbox) ?? []
    );
  }
  orderKey(method: string, args: unknown): string {
    const module = this.modules.find((entry) => entry.reducers[method]);
    return JSON.stringify([
      module?.id ?? method,
      module?.orderKey?.(method, args) ?? "",
    ]);
  }
  private registerWrite(method: string): RegisterWrite | undefined {
    return this.modules.find((entry) => entry.reducers[method])?.registers?.[
      method
    ];
  }
  register(method: string, args: unknown): string | undefined {
    return this.registerWrite(method)?.key(args);
  }
  merge(method: string, earlier: unknown, later: unknown): unknown {
    const merge = this.registerWrite(method)?.merge;
    return merge ? merge(earlier, later) : later;
  }
  debounceMs(method: string, args: unknown): number {
    return this.registerWrite(method)?.debounceMs?.(args) ?? 0;
  }
  operationTitle(method: string): string {
    return (
      this.modules.find((module) => module.operationTitles?.[method])
        ?.operationTitles?.[method] ?? "保存更改"
    );
  }
  supports(method: string): boolean {
    return this.modules.some((m) => !!m.reducers[method]);
  }
  project(
    rows: readonly StoredRow[],
    outbox: readonly OutboxItem[],
    user: string,
  ): readonly StoredRow[] {
    return outbox
      .filter((op) => op.state !== "failed")
      .reduce((view, op) => {
        const module = this.modules.find((m) => m.reducers[op.method]);
        return module
          ? module.reducers[op.method]!(view, op.args, { user, op: op.op })
          : view;
      }, rows);
  }
}
