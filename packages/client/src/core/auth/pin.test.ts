import { describe, expect, it } from "vitest";
import { pbkdf2Sync, webcrypto } from "node:crypto";
import { AppError } from "@talos/base";
import {
  authMessage,
  createPinVerifier,
  PIN_ITERATIONS,
  verifyPin,
} from "./pin.ts";
const crypto = webcrypto as unknown as Crypto;
describe("offline PIN verifier", () => {
  it("uses compatible salted PBKDF2 without SubtleCrypto", async () => {
    const fallback = {
      getRandomValues: crypto.getRandomValues.bind(crypto),
    } as Crypto;
    const a = await createPinVerifier("012345", fallback);
    const b = await createPinVerifier("012345", fallback);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).toBe(
      pbkdf2Sync(
        "012345",
        Buffer.from(a.salt, "hex"),
        PIN_ITERATIONS,
        32,
        "sha256",
      ).toString("hex"),
    );
    expect(await verifyPin("012345", a, crypto)).toBe(true);
    const native = await createPinVerifier("012345", crypto);
    expect(await verifyPin("012345", native, fallback)).toBe(true);
    expect(await verifyPin("012346", native, fallback)).toBe(false);
    await expect(
      verifyPin("012345", { ...a, iterations: 1 }, fallback),
    ).rejects.toMatchObject({ code: "E_INTEGRITY" });
  });
  it("stores independent salted PBKDF2 hashes and checks the complete PIN", async () => {
    const a = await createPinVerifier("654321", crypto);
    const b = await createPinVerifier("654321", crypto);
    expect(a.iterations).toBe(PIN_ITERATIONS);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(JSON.stringify(a)).not.toContain("654321");
    expect(await verifyPin("654321", a, crypto)).toBe(true);
    expect(await verifyPin("654320", a, crypto)).toBe(false);
    expect(await verifyPin("123", a, crypto)).toBe(false);
  });
  it("rejects malformed records and invalid PIN syntax", async () => {
    await expect(createPinVerifier("abcdef", crypto)).rejects.toMatchObject({
      code: "E_INVALID",
    });
    await expect(
      verifyPin("123456", { salt: "00", hash: "00", iterations: 1 }, crypto),
    ).rejects.toMatchObject({ code: "E_INTEGRITY" });
  });
  it.each([
    ["E_UNAUTHENTICATED", "PIN 不正确，请重试"],
    ["E_RATE_LIMITED", "尝试次数过多，请稍后再试"],
    ["E_OFFLINE", "此账户尚未在本机登录，请联网后首次登录"],
    ["E_DISCONNECTED", "此账户尚未在本机登录，请联网后首次登录"],
    ["E_DENIED", "此设备或账户暂不可用，请联系管理员"],
  ] as const)("uses exact wording for %s", (code, message) => {
    expect(authMessage(new AppError(code, "wire detail"))).toBe(message);
  });
});
