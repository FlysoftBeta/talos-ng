import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Sha256, sha256, sha256Hex } from "./sha256.ts";
import { toHex, utf8Encode } from "./bytes.ts";
describe("SHA-256 / FIPS 180-4", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
    [
      "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    ],
    [
      "a".repeat(1000000),
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    ],
  ])("matches NIST vector %#", (text, expected) => {
    expect(sha256Hex(utf8Encode(text))).toBe(expected);
  });
  it("matches node:crypto across padding/block boundaries and many random sizes", () => {
    const sizes = [
      ...Array.from({ length: 140 }, (_, i) => i),
      255,
      256,
      511,
      512,
      1023,
      4096,
      65535,
      1048576,
    ];
    for (const size of sizes) {
      const input = randomBytes(size + 8).subarray(4, size + 4);
      const expected = createHash("sha256").update(input).digest("hex");
      expect(sha256Hex(input)).toBe(expected);
      expect(toHex(sha256(input))).toBe(expected);
      const hash = new Sha256();
      for (let offset = 0; offset < size;) {
        const end = Math.min(size, offset + 1 + ((offset * 17) % 127));
        hash.update(input.subarray(offset, end));
        offset = end;
      }
      hash.update(new Uint8Array());
      expect(hash.digestHex()).toBe(expected);
    }
  });
  it("copies input into state, returns fresh digests, and refuses updates after finalization", () => {
    const bytes = utf8Encode("abc");
    const hash = new Sha256().update(bytes);
    bytes.fill(0);
    const first = hash.digest();
    first.fill(0);
    expect(hash.digestHex()).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(() => hash.update(new Uint8Array())).toThrow();
  });
});
