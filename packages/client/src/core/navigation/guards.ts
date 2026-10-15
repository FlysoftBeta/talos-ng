import type { NavIntent } from "./nav.ts";
export interface GuardedNavigation {
  intent: NavIntent;
  proceed(): void;
  cancel(): void;
}
export type NavGuard = (navigation: GuardedNavigation) => boolean;
/** A guard may defer continuation. New requests invalidate old confirmation callbacks. */
export class NavGuards {
  private readonly guards = new Set<NavGuard>();
  private generation = 0;
  add(guard: NavGuard): () => void {
    this.guards.add(guard);
    return () => {
      this.guards.delete(guard);
    };
  }
  request(intent: NavIntent, commit: () => void): void {
    const generation = ++this.generation;
    const guards = [...this.guards];
    const visit = (index: number): void => {
      if (generation !== this.generation) return;
      const guard = guards[index];
      if (!guard) {
        ++this.generation;
        commit();
        return;
      }
      let settled = false;
      const proceed = () => {
        if (!settled) {
          settled = true;
          visit(index + 1);
        }
      };
      const cancel = () => {
        if (!settled) {
          settled = true;
          if (generation === this.generation) ++this.generation;
        }
      };
      if (!this.guards.has(guard) || guard({ intent, proceed, cancel }))
        proceed();
    };
    visit(0);
  }
  /** Concealment cannot wait for confirmation. Guards retain work for the next unlock. */
  conceal(): void {
    ++this.generation;
    for (const guard of this.guards)
      guard({ intent: { type: "lock" }, proceed() {}, cancel() {} });
  }
}
