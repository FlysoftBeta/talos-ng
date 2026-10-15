/** Synchronous snapshot delivery. Errors are isolated, including errors in the reporter. */
export class Emitter<T> {
  private readonly listeners = new Set<(event: T) => void>();
  constructor(private readonly onError?: (error: unknown) => void) {}
  on(listener: (event: T) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(event: T): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (error) {
        try {
          this.onError?.(error);
        } catch {
          /* Reporter failures must not break delivery. */
        }
      }
    }
  }
  clear(): void {
    this.listeners.clear();
  }
}
