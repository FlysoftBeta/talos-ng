import { describe, expect, it } from "vitest";
import { AppError, equals, utf8Encode, writeU32BE } from "@talos/base";
import { decodeFrame, encodeFrame } from "./codec.ts";
import { MAX_HEADER_BYTES } from "./protocol.ts";
import type { FrameInput } from "./protocol.ts";
const frames: FrameInput[] = [
  { type: 1, header: { v: 1, build: "开发", device: null, lang: "zh-CN" } },
  {
    type: 2,
    header: { v: 1, build: "test", now: 123, device: "d", conn: "c" },
  },
  {
    type: 3,
    header: {
      id: 0,
      m: "echo",
      a: [null, true, "你好"],
      op: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    },
  },
  { type: 4, header: { id: 1, ok: true, d: null } },
  {
    type: 4,
    header: {
      id: 2,
      ok: false,
      e: { code: "E_DENIED", message: "拒绝", data: { why: 1 } },
    },
  },
  { type: 5, header: { t: "news", d: { n: 2 } } },
  { type: 6, header: { n: 42 } },
  { type: 7, header: { n: 42 } },
  { type: 8, header: { id: 42 } },
  { type: 9, header: { code: "E_VERSION" } },
];
function raw(type: number, header: unknown): Uint8Array {
  const json = utf8Encode(JSON.stringify(header));
  const bytes = new Uint8Array(json.length + 5);
  bytes[0] = type;
  writeU32BE(bytes, json.length, 1);
  bytes.set(json, 5);
  return bytes;
}
describe("frame codec", () => {
  it.each(frames)(
    "round-trips type $type including zero-copy body",
    (frame) => {
      const body = new Uint8Array([0, 255, 1, 2]);
      const encoded = encodeFrame({ ...frame, body });
      const padded = new Uint8Array(encoded.length + 10);
      padded.set(encoded, 3);
      const decoded = decodeFrame(padded.subarray(3, 3 + encoded.length));
      expect(decoded).toEqual({ ...frame, body });
      expect(decoded.body.buffer).toBe(padded.buffer);
      expect(encoded[0]).toBe(frame.type);
      expect(new DataView(encoded.buffer).getUint32(1)).toBe(
        encoded.length - body.length - 5,
      );
    },
  );
  it.each([
    [0, {}],
    [10, {}],
    [1, null],
    [1, []],
    [1, 1],
    [1, { v: 1, build: "b", device: null, lang: "en" }],
    [2, { v: 1, build: "b", now: -1, device: "d", conn: "c" }],
    [3, { id: 0.5, m: "m", a: null }],
    [3, { id: 1, m: "m" }],
    [3, { id: 1, m: "m", a: null, op: "invalid" }],
    [4, { id: 1, ok: true }],
    [4, { id: 1, ok: false, e: { code: "oops", message: "x" } }],
    [5, { t: "", d: 1 }],
    [6, { n: -1 }],
    [7, { n: 1.1 }],
    [8, { id: 1e30 }],
    [9, { code: "E_NOPE" }],
    [9, { code: "E_VERSION", message: null }],
  ])("rejects malformed header %j %j", (type, header) => {
    expect(() => decodeFrame(raw(type as number, header))).toThrow(
      expect.objectContaining({ code: "E_PROTOCOL" }),
    );
  });
  it("rejects truncation, invalid UTF-8, invalid JSON and header overflow", () => {
    const valid = raw(6, { n: 1 });
    for (let length = 0; length < valid.length; length++)
      expect(() => decodeFrame(valid.subarray(0, length))).toThrow(AppError);
    for (const payload of [new Uint8Array([0xff]), utf8Encode("{")]) {
      const bytes = new Uint8Array(5 + payload.length);
      bytes[0] = 6;
      writeU32BE(bytes, payload.length, 1);
      bytes.set(payload, 5);
      expect(() => decodeFrame(bytes)).toThrow(
        expect.objectContaining({ code: "E_PROTOCOL" }),
      );
    }
    const bytes = new Uint8Array(MAX_HEADER_BYTES + 6);
    bytes[0] = 6;
    writeU32BE(bytes, MAX_HEADER_BYTES + 1, 1);
    expect(() => decodeFrame(bytes)).toThrow(AppError);
    expect(() =>
      encodeFrame({
        type: 5,
        header: { t: "x", d: "x".repeat(MAX_HEADER_BYTES) },
      }),
    ).toThrow(AppError);
  });
  it("supports exact frame/header boundaries and large bodies", () => {
    const frame = { type: 5 as const, header: { t: "x", d: "" } };
    const overhead = encodeFrame(frame).length;
    const body = new Uint8Array(4 * 1024 * 1024 - overhead).fill(123);
    const bytes = encodeFrame({ ...frame, body });
    expect(equals(decodeFrame(bytes).body, body)).toBe(true);
    expect(() =>
      decodeFrame(bytes, { maxFrameBytes: bytes.length - 1 }),
    ).toThrow(AppError);
    expect(() =>
      encodeFrame({ ...frame, body: new Uint8Array(body.length + 1) }),
    ).toThrow(AppError);
    frame.header.d = "x".repeat(MAX_HEADER_BYTES - (overhead - 5));
    expect(decodeFrame(encodeFrame(frame)).header).toEqual(frame.header);
  });
  it("rejects non-JSON local data and validates serialized fields", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const a of [cycle, undefined])
      expect(() =>
        encodeFrame({ type: 3, header: { id: 0, m: "m", a } }),
      ).toThrow(AppError);
    expect(() => encodeFrame({ type: 6, header: { n: NaN } })).toThrow(
      AppError,
    );
  });
  it("fuzzes arbitrary bytes and randomized round trips deterministically", () => {
    let seed = 1;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let i = 0; i < 2000; i++) {
      const bytes = Uint8Array.from(
        { length: random() % 128 },
        () => random() % 256,
      );
      try {
        const frame = decodeFrame(bytes);
        expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("E_PROTOCOL");
      }
      const body = bytes;
      const frame = {
        type: 3 as const,
        header: {
          id: random(),
          m: "fuzz",
          a: { text: String(random()), values: [random(), null] },
        },
        body,
      };
      expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
    }
  });
});
