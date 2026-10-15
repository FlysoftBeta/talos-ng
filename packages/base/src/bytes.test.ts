import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import * as bytes from "./bytes.ts";
describe("byte utilities", () => {
  it("concatenates copies, compares contents, and respects subarray offsets", () => {
    const a = new Uint8Array([1, 2, 3]).subarray(1);
    const result = bytes.concat(a, new Uint8Array([4]));
    expect([...result]).toEqual([2, 3, 4]);
    a[0] = 9;
    expect([...result]).toEqual([2, 3, 4]);
    expect(bytes.concat()).toEqual(new Uint8Array());
    expect(bytes.equals(result, new Uint8Array([2, 3, 4]))).toBe(true);
    expect(bytes.equals(result, a)).toBe(false);
    expect(bytes.equals(result, new Uint8Array([2, 3, 5]))).toBe(false);
  });
  it("roundtrips hex and base64url against Node over random lengths", () => {
    for (let size = 0; size < 260; size++) {
      const value = randomBytes(size);
      expect(bytes.toHex(value)).toBe(value.toString("hex"));
      expect(
        bytes.equals(bytes.fromHex(value.toString("hex").toUpperCase()), value),
      ).toBe(true);
      expect(bytes.toBase64Url(value)).toBe(value.toString("base64url"));
      expect(
        bytes.equals(bytes.fromBase64Url(value.toString("base64url")), value),
      ).toBe(true);
    }
  });
  it("rejects malformed and noncanonical encodings", () => {
    for (const value of ["a", "gg", " aa", "00\n"])
      expect(() => bytes.fromHex(value)).toThrow();
    for (const value of ["a", "a=", "ab", "aab", "+/", "YQ==", "YQ\n"])
      expect(() => bytes.fromBase64Url(value)).toThrow();
  });
  it("handles UTF-8 including astral characters, empty input and malformed sequences", () => {
    for (const text of ["", "hello", "你好 🌍", "\u0000", "\ufeffx"]) {
      expect(bytes.toHex(bytes.utf8Encode(text))).toBe(
        Buffer.from(text).toString("hex"),
      );
      expect(bytes.utf8Decode(bytes.utf8Encode(text))).toBe(
        text.replace(/^\ufeff/, ""),
      );
    }
    expect(bytes.utf8Decode(new Uint8Array([255]))).toBe("\ufffd");
    expect(() => bytes.utf8Decode(new Uint8Array([255]), true)).toThrow();
    expect(bytes.utf8Decode(bytes.utf8Encode("\ud800"))).toBe("\ufffd");
  });
  it("reads and writes unsigned integers without truncation", () => {
    const buffer = new Uint8Array(12).fill(0xaa);
    for (const value of [0, 1, 2147483648, 4294967295]) {
      bytes.writeU32BE(buffer, value, 2);
      expect(bytes.readU32BE(buffer, 2)).toBe(value);
      expect(buffer[1]).toBe(0xaa);
      expect(buffer[6]).toBe(0xaa);
    }
    for (const value of [0, 4294967296, Number.MAX_SAFE_INTEGER]) {
      bytes.writeU64BE(buffer, value, 2);
      expect(bytes.readU64BE(buffer, 2)).toBe(value);
    }
    expect(bytes.readU32BE(new Uint8Array([255, 255, 255, 255]))).toBe(
      4294967295,
    );
    expect(() => bytes.readU64BE(new Uint8Array(8).fill(255))).toThrow();
  });
  it("rejects unsafe integers and out-of-bounds accesses before writing", () => {
    const buffer = new Uint8Array(8);
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => bytes.writeU64BE(buffer, value)).toThrow();
    expect(() => bytes.writeU32BE(buffer, 4294967296)).toThrow();
    for (const offset of [-1, 0.5, NaN, 5]) {
      expect(() => bytes.readU32BE(buffer, offset)).toThrow();
      expect(() => bytes.writeU32BE(buffer, 1, offset)).toThrow();
    }
    expect(() => bytes.writeU64BE(buffer, 1, 1)).toThrow();
    expect([...buffer]).toEqual(Array(8).fill(0));
  });
});
