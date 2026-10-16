import { AppError } from "@talos/base";
import { migrate } from "./db.ts";
import type { Db } from "./db.ts";
export interface Change {
  readonly scope: string;
  readonly type: string;
  readonly id: string;
}
export interface ChangeSet {
  readonly rev: number;
  readonly changes: readonly Change[];
}
export type PostCommitEffect = () => void | Promise<void>;
export interface WriteContext {
  readonly rev: number;
  changed(scope: string, type: string, id: string): void;
  afterCommit(effect: PostCommitEffect): void;
}
export class Uow {
  private active?: WriteContext;
  constructor(
    private readonly db: Db,
    private readonly sink: { committed(set: ChangeSet): void },
    private readonly reportError: (error: unknown) => void = () => {},
  ) {
    migrate(db, "uow", [
      {
        n: 1,
        up: (db) =>
          db.exec(
            "CREATE TABLE _revision(id INTEGER PRIMARY KEY CHECK(id=1),rev INTEGER NOT NULL) STRICT; INSERT INTO _revision VALUES(1,0)",
          ),
      },
    ]);
  }
  get current(): WriteContext | undefined {
    return this.active;
  }
  get revision(): number {
    return this.db.get<{ rev: number }>("SELECT rev FROM _revision WHERE id=1")!
      .rev;
  }
  write<T>(fn: (ctx: WriteContext) => T, label?: string): T {
    // Nested writes join the existing unit, but failed nested work gets its own
    // savepoint and cannot leak changes/effects into the parent.
    const parent = this.active;
    if (!parent && this.db.inTransaction)
      throw new AppError("E_CONFLICT", "工作单元必须拥有外层事务");
    const effects: PostCommitEffect[] = [];
    const changes = new Map<string, Change>();
    let context!: WriteContext;
    const result = this.db.tx(() => {
      if (!parent) this.db.run("UPDATE _revision SET rev=rev+1 WHERE id=1");
      context = {
        rev: parent?.rev ?? this.revision,
        changed: (scope, type, id) => {
          changes.set(JSON.stringify([scope, type, id]), { scope, type, id });
        },
        afterCommit: (effect) => {
          effects.push(effect);
        },
      };
      this.active = context;
      try {
        return fn(context);
      } finally {
        this.active = parent;
      }
    }, label);
    if (parent) {
      for (const change of changes.values())
        parent.changed(change.scope, change.type, change.id);
      for (const effect of effects) parent.afterCommit(effect);
    } else {
      for (const effect of [
        () =>
          this.sink.committed({
            rev: context.rev,
            changes: [...changes.values()],
          }),
        ...effects,
      ]) {
        try {
          const pending = effect();
          if (pending)
            void pending.catch((error) => {
              try {
                this.reportError(error);
              } catch {
                /* Reporting cannot undo a commit. */
              }
            });
        } catch (error) {
          try {
            this.reportError(error);
          } catch {
            /* Commit remains successful. */
          }
        }
      }
    }
    return result;
  }
}
