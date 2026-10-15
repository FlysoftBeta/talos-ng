import { Emitter } from "./events.ts";
export type TransitionTable<S extends string, E extends string> = {
  readonly [State in S]: { readonly [Event in E]: S | null };
};
export interface Transition<S, E> {
  from: S;
  to: S;
  event: E;
}
export interface Fsm<S extends string, E extends string> {
  readonly state: S;
  send(event: E): boolean;
  onTransition(listener: (transition: Transition<S, E>) => void): () => void;
}
export function createFsm<S extends string, E extends string>(options: {
  initial: S;
  transitions: TransitionTable<S, E>;
  onTransition?: (transition: Transition<S, E>) => void;
}): Fsm<S, E> {
  let state = options.initial;
  const emitter = new Emitter<Transition<S, E>>();
  if (options.onTransition) emitter.on(options.onTransition);
  return {
    get state() {
      return state;
    },
    send(event) {
      const to = options.transitions[state][event];
      if (to === null) return false;
      const from = state;
      state = to;
      emitter.emit({ from, to, event });
      return true;
    },
    onTransition: (listener) => emitter.on(listener),
  };
}
