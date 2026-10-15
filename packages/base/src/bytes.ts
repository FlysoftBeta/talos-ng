// Module-local declarations do not add DOM/Node globals to consumers.
declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };
declare const TextDecoder: {
  new (
    label?: string,
    options?: { fatal?: boolean },
  ): { decode(input: Uint8Array): string };
};
export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
/** Constant-work for equal lengths; not a cryptographic timing guarantee in JS. */
export function equals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i]! ^ b[i]!;
  return different === 0;
}
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex))
    throw new TypeError("Invalid hexadecimal");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += BASE64[(buffer >>> bits) & 63];
    }
  }
  if (bits) out += BASE64[(buffer << (6 - bits)) & 63];
  return out;
}
export function fromBase64Url(text: string): Uint8Array {
  if (/[^A-Za-z0-9_-]/.test(text) || text.length % 4 === 1)
    throw new TypeError("Invalid unpadded base64url");
  const out = new Uint8Array(Math.floor((text.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const char of text) {
    buffer = (buffer << 6) | BASE64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[offset++] = (buffer >>> bits) & 255;
    }
  }
  if (bits && (buffer & ((1 << bits) - 1)) !== 0)
    throw new TypeError("Noncanonical base64url padding bits");
  return out;
}
export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
export function utf8Decode(bytes: Uint8Array, fatal = false): string {
  return new TextDecoder("utf-8", { fatal }).decode(bytes);
}
function bounds(bytes: Uint8Array, offset: number, size: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset + size > bytes.length)
    throw new RangeError("Byte offset out of range");
}
function unsigned(value: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw new RangeError("Unsigned integer out of range");
}
export function readU32BE(bytes: Uint8Array, offset = 0): number {
  bounds(bytes, offset, 4);
  return (
    bytes[offset]! * 16777216 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}
export function writeU32BE(bytes: Uint8Array, value: number, offset = 0): void {
  bounds(bytes, offset, 4);
  unsigned(value, 4294967295);
  for (let i = 3; i >= 0; i--) {
    bytes[offset + i] = value & 255;
    value = Math.floor(value / 256);
  }
}
export function readU64BE(bytes: Uint8Array, offset = 0): number {
  bounds(bytes, offset, 8);
  const value =
    readU32BE(bytes, offset) * 4294967296 + readU32BE(bytes, offset + 4);
  unsigned(value, Number.MAX_SAFE_INTEGER);
  return value;
}
export function writeU64BE(bytes: Uint8Array, value: number, offset = 0): void {
  bounds(bytes, offset, 8);
  unsigned(value, Number.MAX_SAFE_INTEGER);
  writeU32BE(bytes, Math.floor(value / 4294967296), offset);
  writeU32BE(bytes, value % 4294967296, offset + 4);
}
