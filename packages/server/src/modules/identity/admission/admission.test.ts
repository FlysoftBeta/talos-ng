import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PIN_THROTTLE_MS } from "@talos/contract";
import { Db } from "../../../kernel/persistence/db.ts";
import { Uow } from "../../../kernel/persistence/uow.ts";
import { IdentityService } from "../index.ts";
function setup() {
  const db = new Db();
  let now = 1000;
  const service = new IdentityService({
    db,
    uow: new Uow(db, { committed: () => {} }),
    now: () => now,
  });
  return {
    db,
    service,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
describe("identity admission and onboarding", () => {
  it("one-time invitations bind redemption to a device and accept equivalent backup PINs", async () => {
    const s = setup();
    try {
      const invite = await s.service.issueInvitation();
      const device = s.service.registerDevice();
      const other = s.service.registerDevice();
      const login = await s.service.loginAsync(device, invite.pin);
      if (!("onboarding" in login)) throw new Error("expected onboarding");
      const args = {
        invitationToken: login.invitationToken,
        pins: ["123456", "654321"],
        handle: "Alice_1",
        name: " 小明 ",
      };
      await expect(
        s.service.completeOnboarding(other, args),
      ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
      const session = await s.service.completeOnboarding(device, args);
      expect(session.user.name).toBe("小明");
      expect(s.service.login(other, "654321").user.id).toBe(session.user.id);
      await expect(
        s.service.completeOnboarding(device, args),
      ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
      await expect(
        s.service.loginAsync(device, invite.pin),
      ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
    } finally {
      s.db.close();
    }
  });
  it("rejects duplicate or reserved PINs, handles and expired invitations atomically", async () => {
    const s = setup();
    try {
      s.service.createUser({
        pin: "111111",
        handle: "Alice",
        name: "已有用户",
      });
      const invite = await s.service.issueInvitation();
      const device = s.service.registerDevice();
      const result = await s.service.loginAsync(device, invite.pin);
      if (!("onboarding" in result)) throw new Error();
      const args = {
        invitationToken: result.invitationToken,
        pins: ["222222"],
        handle: "alice",
        name: "新用户",
      };
      await expect(
        s.service.completeOnboarding(device, args),
      ).rejects.toMatchObject({ code: "E_CONFLICT" });
      for (const pins of [["111111"], [invite.pin], ["222222", "222222"]])
        await expect(
          s.service.completeOnboarding(device, {
            ...args,
            handle: "bob",
            pins,
          }),
        ).rejects.toBeDefined();
      expect(s.service.repo.countUsers()).toBe(1);
      s.advance(15 * 60 * 1000);
      await expect(
        s.service.completeOnboarding(device, { ...args, handle: "bob" }),
      ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
    } finally {
      s.db.close();
    }
  });
  it("replaces both PINs, checks current ownership, preserves this session and revokes others", async () => {
    const s = setup();
    try {
      const user = s.service.createUser({ pin: "111111", name: "一" });
      s.service.createUser({ pin: "222222", name: "二" });
      const device = s.service.registerDevice();
      const other = s.service.registerDevice();
      const current = s.service.login(device, "111111");
      const previous = s.service.login(other, "111111");
      await expect(
        s.service.replacePins(user.id, device, tokenHash(current.token), {
          currentPin: "222222",
          pins: ["333333"],
        }),
      ).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
      await expect(
        s.service.replacePins(user.id, device, tokenHash(current.token), {
          currentPin: "111111",
          pins: ["222222"],
        }),
      ).rejects.toMatchObject({ code: "E_CONFLICT" });
      const changed = await s.service.replacePins(
        user.id,
        device,
        tokenHash(current.token),
        {
          currentPin: "111111",
          pins: ["333333", "444444"],
        },
      );
      expect(changed.credentialVersion).toBeGreaterThan(
        current.credentialVersion,
      );
      expect(s.service.resume(device, current.token).credentialVersion).toBe(
        changed.credentialVersion,
      );
      expect(s.service.resume(device, current.token).user.id).toBe(user.id);
      expect(() => s.service.resume(other, previous.token)).toThrow();
      expect(() => s.service.login(device, "111111")).toThrow();
      expect(s.service.login(other, "444444").user.id).toBe(user.id);
      const hashes = s.db.all<{ hash: string; salt: string; verifier: string }>(
        "SELECT hash,salt,verifier FROM user_pins WHERE user_id=?",
        user.id,
      );
      expect(hashes).toHaveLength(2);
      expect(
        hashes.every(
          (row) =>
            row.hash.startsWith("s2:") &&
            row.salt.length === 32 &&
            row.verifier.length === 64,
        ),
      ).toBe(true);
      expect(hashes[0]!.salt).not.toBe(hashes[1]!.salt);
    } finally {
      s.db.close();
    }
  });
  it("upgrades legacy HMAC credentials after successful verification", async () => {
    const s = setup();
    try {
      const user = s.service.createUser({ pin: "123456", name: "旧用户" });
      const legacy = createHmac(
        "sha256",
        Buffer.from(s.service.credentials.secret()!, "hex"),
      )
        .update("123456")
        .digest("hex");
      s.db.run(
        "UPDATE user_pins SET hash=?,salt=NULL,verifier=NULL WHERE user_id=?",
        legacy,
        user.id,
      );
      const result = await s.service.loginAsync(
        s.service.registerDevice(),
        "123456",
      );
      expect("user" in result && result.user.id).toBe(user.id);
      expect(
        s.db.get<{ hash: string; verifier: string }>("SELECT * FROM user_pins")!
          .hash,
      ).toMatch(/^s2:/);
      expect(s.service.credentials.pin(legacy)).toBeUndefined();
    } finally {
      s.db.close();
    }
  });
  it("accepts classapp-next hashes keyed by the printable PIN secret", async () => {
    const s = setup();
    try {
      const user = s.service.createUser({ pin: "123456", name: "旧用户" });
      const legacy = createHmac("sha256", s.service.credentials.secret()!)
        .update("123456")
        .digest("hex");
      s.db.run(
        "UPDATE user_pins SET hash=?,salt=NULL,verifier=NULL WHERE user_id=?",
        legacy,
        user.id,
      );
      const result = await s.service.loginAsync(
        s.service.registerDevice(),
        "123456",
      );
      expect("user" in result && result.user.id).toBe(user.id);
      expect(s.service.credentials.pin(legacy)).toBeUndefined();
    } finally {
      s.db.close();
    }
  });
  it("reports each admission reason and recovers idle admission using a fresh PIN", () => {
    const s = setup();
    try {
      const user = s.service.createUser({ pin: "123456", name: "普通" });
      const root = s.service.createUser({
        pin: "654321",
        name: "管理",
        roles: ["root"],
      });
      const device = s.service.registerDevice();
      expect(() => s.service.login("missing", "123456")).toThrow(
        expect.objectContaining({ data: { reason: "invalid-client" } }),
      );
      s.db.run("UPDATE identity_policy SET whitelist=1");
      expect(() => s.service.login(device, "123456")).toThrow(
        expect.objectContaining({ data: { reason: "whitelist-required" } }),
      );
      s.db.run("UPDATE devices SET whitelisted=1,banned=1");
      expect(() => s.service.login(device, "123456")).toThrow(
        expect.objectContaining({ data: { reason: "banned" } }),
      );
      s.db.run("UPDATE devices SET banned=0,bound_user=?", root.id);
      s.db.run("UPDATE users SET banned=1 WHERE id=?", root.id);
      expect(() => s.service.login(device, "123456")).toThrow(
        expect.objectContaining({ data: { reason: "bound-to-other-user" } }),
      );
      s.db.run("UPDATE devices SET bound_user=NULL");
      s.db.run("UPDATE users SET banned=0");
      const session = s.service.login(device, "123456");
      s.db.run("UPDATE identity_policy SET system_lock=1");
      expect(() => s.service.resume(device, session.token)).toThrow(
        expect.objectContaining({ data: { reason: "system-lock" } }),
      );
      expect(s.service.login(device, "654321").user.id).toBe(root.id);
      s.db.run("UPDATE identity_policy SET system_lock=0,idle_lock=1");
      s.advance(300001);
      expect(() => s.service.resume(device, session.token)).toThrow(
        expect.objectContaining({ data: { reason: "idle-lock" } }),
      );
      expect(s.service.login(device, "123456").user.id).toBe(user.id);
    } finally {
      s.db.close();
    }
  });
  it("enforces an IP budget across newly registered devices and expires both budgets", async () => {
    const s = setup();
    try {
      s.service.createUser({ pin: "123456", name: "用户" });
      for (let i = 0; i < 20; i++) {
        const device = s.service.registerDevice();
        await expect(
          s.service.loginAsync(device, "000000", "10.0.0.1"),
        ).rejects.toMatchObject({
          code: i === 19 ? "E_RATE_LIMITED" : "E_UNAUTHENTICATED",
        });
      }
      const device = s.service.registerDevice();
      await expect(
        s.service.loginAsync(device, "123456", "10.0.0.1"),
      ).rejects.toMatchObject({
        data: { reason: "throttled", retryAt: 1000 + PIN_THROTTLE_MS },
      });
      s.advance(PIN_THROTTLE_MS);
      await expect(
        s.service.loginAsync(device, "123456", "10.0.0.1"),
      ).resolves.toHaveProperty("user");
    } finally {
      s.db.close();
    }
  }, 60_000);
  it("profile edits trim names, preserve independent fields and reject empty input", () => {
    const s = setup();
    try {
      const user = s.service.createUser({
        pin: "123456",
        name: "甲",
        handle: "alice",
      });
      expect(
        s.service.updateProfile(user.id, { name: " 乙 " }).user,
      ).toMatchObject({ handle: "alice", name: "乙" });
      expect(
        s.service.updateProfile(user.id, { handle: "Alice2" }).user.name,
      ).toBe("乙");
      expect(() => s.service.updateProfile(user.id, { name: " " })).toThrow();
      expect(() => s.service.updateProfile(user.id, {})).toThrow();
    } finally {
      s.db.close();
    }
  });
});
