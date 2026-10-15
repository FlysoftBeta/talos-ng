/** Observable immutable state for feature controllers (useSyncExternalStore-compatible). */
export class StateStore<S> {
  private listeners = new Set<() => void>();
  constructor(protected state: S) {}
  getState = (): S => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  protected patch(value: Partial<S>): void {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener());
  }
}
