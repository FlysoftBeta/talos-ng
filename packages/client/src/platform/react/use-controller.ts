import { useEffect, useState, useSyncExternalStore } from "react";

interface Controller<S> {
  getState(): S;
  subscribe(listener: () => void): () => void;
  attach?(): void;
  detach?(): void;
}
/** The one React binding for observable feature controllers (core/controller-state.ts StateStore and alike). Creates a controller once per mount, attaches it to the runtime and returns it with its current state. */
export function useController<C extends Controller<unknown>>(
  create: () => C,
): [C, ReturnType<C["getState"]>] {
  const [controller] = useState(create);
  useEffect(() => {
    controller.attach?.();
    return () => controller.detach?.();
  }, [controller]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  return [controller, state as ReturnType<C["getState"]>];
}
