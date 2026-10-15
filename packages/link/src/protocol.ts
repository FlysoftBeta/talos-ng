import type { AppErrorJSON, ErrorCode } from "@talos/base";

export const FrameType = {
  HELLO: 1,
  WELCOME: 2,
  CALL: 3,
  REPLY: 4,
  EVENT: 5,
  PING: 6,
  PONG: 7,
  CANCEL: 8,
  BYE: 9,
} as const;
export interface HelloHeader {
  v: number;
  build: string;
  device: string | null;
  lang: "zh-CN";
}
export interface WelcomeHeader {
  v: number;
  build: string;
  now: number;
  device: string;
  conn: string;
}
export interface CallHeader {
  id: number;
  m: string;
  a: unknown;
  op?: string;
}
export type ReplyHeader =
  | { id: number; ok: true; d: unknown }
  | { id: number; ok: false; e: AppErrorJSON };
export interface EventHeader {
  t: string;
  d: unknown;
}
export interface ByeHeader {
  code: ErrorCode;
  message?: string;
}
export interface Headers {
  1: HelloHeader;
  2: WelcomeHeader;
  3: CallHeader;
  4: ReplyHeader;
  5: EventHeader;
  6: { n: number };
  7: { n: number };
  8: { id: number };
  9: ByeHeader;
}
export type Frame = {
  [T in keyof Headers]: { type: T; header: Headers[T]; body: Uint8Array };
}[keyof Headers];
export type FrameInput = {
  [T in keyof Headers]: { type: T; header: Headers[T]; body?: Uint8Array };
}[keyof Headers];
export const MAX_HEADER_BYTES = 256 * 1024;
export const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024;
