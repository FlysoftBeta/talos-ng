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
