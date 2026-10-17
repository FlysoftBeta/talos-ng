import type {
  RuntimeCommandPort,
  RuntimeQueryPort,
  RuntimeFilePort,
  RuntimeClockPort,
  RuntimeNavigationPort,
  RuntimeSessionPort,
  RuntimeSettingsPort,
  RuntimeStatusPort,
} from "../../../core/runtime-port.ts";
export type CommandPort = Pick<
  RuntimeCommandPort,
  "command" | "fetchBody" | "operation"
> &
  Pick<RuntimeQueryPort, "loadRows"> &
  Pick<
    RuntimeFilePort,
    "getLocal" | "setLocal" | "readFile" | "saveFile" | "retainFile"
  >;
export type ConversationPort = CommandPort &
  Pick<RuntimeCommandPort, "can" | "sync" | "retry" | "discard" | "flush"> &
  Pick<RuntimeQueryPort, "getSnapshot" | "outbox"> &
  Pick<RuntimeSessionPort, "gate"> &
  Pick<RuntimeClockPort, "time">;
export type ComposerPort = CommandPort &
  Pick<RuntimeCommandPort, "can"> &
  Pick<RuntimeQueryPort, "getSnapshot"> &
  Pick<RuntimeSessionPort, "gate"> &
  RuntimeClockPort;
export type CommunityPort = Pick<
  RuntimeCommandPort,
  "command" | "can" | "sync"
> &
  RuntimeNavigationPort &
  Pick<RuntimeQueryPort, "getSnapshot">;
export type MediaPort = CommandPort & Pick<RuntimeCommandPort, "can">;
export type RetentionPort = CommandPort &
  Pick<RuntimeCommandPort, "can"> &
  Pick<RuntimeQueryPort, "getSnapshot" | "hasScope"> &
  Pick<RuntimeFilePort, "releaseFiles"> &
  RuntimeClockPort &
  Pick<RuntimeStatusPort, "setTransfer">;
export type BackgroundPort = Pick<RuntimeCommandPort, "command" | "can"> &
  Pick<RuntimeQueryPort, "getSnapshot"> &
  Pick<RuntimeSettingsPort, "setting"> &
  RuntimeNavigationPort &
  RuntimeClockPort &
  Pick<RuntimeSessionPort, "lock">;
/** Bytes are read by the browser adapter; no browser File type crosses into a model. */
export interface ImageSource {
  size: number;
  read(): Promise<Uint8Array>;
}
