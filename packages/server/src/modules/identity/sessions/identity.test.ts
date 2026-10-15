import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Connection } from "@talos/link";
import { PIN_THROTTLE_MS, SESSION_TTL_MS } from "@talos/contract";
import { Db } from "../../../kernel/persistence/db.ts";
import { Uow } from "../../../kernel/persistence/uow.ts";
import { IdentityService, sessionState } from "../index.ts";
function setup() {
  let now = 1000;
  const db = new Db();
  const uow = new Uow(db, { committed: () => {} });
  const pins: string[] = [];
  const service = new IdentityService({
    db,
    uow,
    now: () => now,
    printRootPin: (pin) => pins.push(pin),
  });
  const conn: Connection = {
    id: "conn",
    device: null,
    info: null,
    ctx: new Map(),
    emit: () => {},
    close: () => {},
  };
  return {
    db,
    service,
    pins,
    conn,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe("identity", () => {
  it("bootstraps once, hashes credentials, and preserves globally unique PINs", () => {
    const s = setup();
    try {
      s.service.bootstrap();
      s.service.bootstrap();
      expect(s.pins).toHaveLength(1);
      expect(s.pins[0]).toMatch(/^\d{6}$/);
      const device = s.service.registerDevice();
      const session = s.service.login(device, s.pins[0]!);
      expect(session.user.roles).toEqual(["administrator", "root"]);
      expect(session.token).toMatch(/^[a-f0-9]{64}$/);
      expect(
        s.db.get<{ hash: string }>("SELECT hash FROM sessions")?.hash,
      ).not.toBe(session.token);
      expect(
        s.db.get<{ hash: string }>("SELECT hash FROM user_pins")?.hash,
      ).not.toBe(s.pins[0]);
      expect(() =>
        s.service.createUser({ pin: s.pins[0]!, name: "other" }),
      ).toThrow(/PIN/);
    } finally {
      s.db.close();
    }
  });
  it("blocks the fifth failed PIN for exactly fifteen minutes", () => {
    const s = setup();
    try {
      s.service.createUser({ pin: "123456", name: "test" });
      const device = s.service.registerDevice();
      for (let i = 0; i < 4; i++)
        expect(() => s.service.login(device, "000000")).toThrow(
          expect.objectContaining({ code: "E_UNAUTHENTICATED" }),
        );
      expect(() => s.service.login(device, "000000")).toThrow(
        expect.objectContaining({ code: "E_RATE_LIMITED" }),
      );
      expect(() => s.service.login(device, "123456")).toThrow(
        expect.objectContaining({ code: "E_RATE_LIMITED" }),
      );
      s.advance(PIN_THROTTLE_MS);
      expect(s.service.login(device, "123456").user.name).toBe("test");
      expect(
        s.db.get<{ failures: number }>("SELECT failures FROM devices")
          ?.failures,
      ).toBe(0);
    } finally {
      s.db.close();
    }
  });
  it("binds one user, locks without revocation, and logout prevents resume", () => {
    const s = setup();
    try {
      const user = s.service.createUser({ pin: "123456", name: "test" });
      const device = s.service.registerDevice();
      const session = s.service.login(device, "123456");
      s.service.bind(s.conn, session, device);
      expect(s.service.authenticate(s.conn)).toEqual({ device, user: user.id });
      s.service.lock(s.conn);
      expect(s.service.authenticate(s.conn)).toEqual({ device });
      const restored = s.service.resume(device, session.token);
      s.service.bind(s.conn, restored, device);
      s.service.logout(s.conn);
      expect(() => s.service.resume(device, session.token)).toThrow(
        expect.objectContaining({ code: "E_UNAUTHENTICATED" }),
      );
      expect(sessionState(s.conn)).toEqual({ device });
    } finally {
      s.db.close();
    }
  });
  it("rejects cross-device tokens, sliding expiry and revoked sessions", () => {
    const s = setup();
    try {
      s.service.createUser({ pin: "123456", name: "test" });
      const device = s.service.registerDevice();
      const session = s.service.login(device, "123456");
      const other = s.service.registerDevice();
      expect(() => s.service.resume(other, session.token)).toThrow(
        expect.objectContaining({ code: "E_UNAUTHENTICATED" }),
      );
      s.advance(SESSION_TTL_MS - 1);
      const fresh = s.service.resume(device, session.token);
      expect(fresh.expires).toBe(session.expires + SESSION_TTL_MS - 1);
      s.service.bind(s.conn, fresh, device);
      s.service.revoke(
        createHash("sha256").update(session.token).digest("hex"),
      );
      expect(s.service.authenticate(s.conn)).toEqual({ device });
      const next = s.service.login(device, "123456");
      s.advance(SESSION_TTL_MS);
      expect(() => s.service.resume(device, next.token)).toThrow(
        expect.objectContaining({ code: "E_UNAUTHENTICATED" }),
      );
    } finally {
      s.db.close();
    }
  });
  it("limits each device to two live accounts and permits replacement of one account", () => {
    const s = setup();
    try {
      s.service.createUser({ pin: "111111", name: "one" });
      s.service.createUser({ pin: "222222", name: "two" });
      s.service.createUser({ pin: "333333", name: "three" });
      const device = s.service.registerDevice();
      const one = s.service.login(device, "111111");
      s.service.login(device, "222222");
      expect(() => s.service.login(device, "333333")).toThrow(
        expect.objectContaining({ code: "E_CONFLICT" }),
      );
      s.service.login(device, "111111");
      expect(() => s.service.resume(device, one.token)).toThrow(
        expect.objectContaining({ code: "E_UNAUTHENTICATED" }),
      );
      s.advance(SESSION_TTL_MS);
      expect(s.service.login(device, "333333").user.name).toBe("three");
    } finally {
      s.db.close();
    }
  });
  it("rechecks ban and binding restrictions on an already bound connection", () => {
    const s = setup();
    try {
      const user = s.service.createUser({ pin: "123456", name: "test" });
      const device = s.service.registerDevice();
      const session = s.service.login(device, "123456");
      s.service.bind(s.conn, session, device);
      s.db.run("UPDATE users SET banned=1 WHERE id=?", user.id);
      expect(s.service.authenticate(s.conn)).toEqual({ device });
      expect(() => s.service.login(device, "123456")).toThrow(
        expect.objectContaining({ code: "E_DENIED" }),
      );
    } finally {
      s.db.close();
    }
  });
});
