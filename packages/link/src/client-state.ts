import { createFsm } from "@talos/base";
export type ClientState =
  "idle" | "connecting" | "open" | "waiting" | "versionMismatch" | "stopped";
type StateEvent = "start" | "welcome" | "lost" | "retry" | "version" | "stop";
export function createClientFsm(): ReturnType<
  typeof createFsm<ClientState, StateEvent>
> {
  return createFsm<ClientState, StateEvent>({
    initial: "idle",
    transitions: {
      idle: {
        start: "connecting",
        welcome: null,
        lost: null,
        retry: null,
        version: null,
        stop: "stopped",
      },
      connecting: {
        start: null,
        welcome: "open",
        lost: "waiting",
        retry: null,
        version: "versionMismatch",
        stop: "stopped",
      },
      open: {
        start: null,
        welcome: null,
        lost: "waiting",
        retry: null,
        version: "versionMismatch",
        stop: "stopped",
      },
      waiting: {
        start: null,
        welcome: null,
        lost: null,
        retry: "connecting",
        version: null,
        stop: "stopped",
      },
      versionMismatch: {
        start: null,
        welcome: null,
        lost: null,
        retry: null,
        version: null,
        stop: "stopped",
      },
      stopped: {
        start: null,
        welcome: null,
        lost: null,
        retry: null,
        version: null,
        stop: null,
      },
    },
  });
}
