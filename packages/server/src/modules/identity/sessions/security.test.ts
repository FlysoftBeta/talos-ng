import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred } from "@talos/base";
import { Db } from "../../../kernel/persistence/db.ts";
import { Uow } from "../../../kernel/persistence/uow.ts";
import { IdentityService } from "../index.ts";
import { PinCredentials } from "../credentials.ts";

const databases: Db[] = [];
function setup() {
  const db = new Db();
  databases.push(db);
  const service = new IdentityService({
    db,
    uow: new Uow(db, { committed: () => {} }),
    now: () => 1000,
  });
  return { db, service };
}
function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
async function invitation(service: IdentityService, device: string) {
  const issued = await service.issueInvitation();
  const result = await service.loginAsync(device, issued.pin);
  if (!("onboarding" in result)) throw new Error("Expected invitation");
  return result.invitationToken;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});

describe("credential transaction races", () => {
  it("redeems the same invitation exactly once under concurrent completion", async () => {
    const { db, service } = setup();
    const device = service.registerDevice();
    const invitationToken = await invitation(service, device);
    const outcomes = await Promise.allSettled([
      service.completeOnboarding(device, {
        invitationToken,
        pins: ["321456"],
        handle: "alice",
        name: "甲",
      }),
      service.completeOnboarding(device, {
        invitationToken,
        pins: ["321457"],
        handle: "bob",
        name: "乙",
      }),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason).toMatchObject({
      code: "E_UNAUTHENTICATED",
    });
    expect(service.repo.countUsers()).toBe(1);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM sessions")!.n).toBe(1);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM user_pins")!.n).toBe(
      1,
    );
  });

  it("serializes PIN ownership across onboarding and an existing user's replacement", async () => {
    const { db, service } = setup();
    const user = service.createUser({ pin: "111111", name: "已有账号" });
    const device = service.registerDevice();
    const session = service.login(device, "111111");
    const inviteDevice = service.registerDevice();
    const invitationToken = await invitation(service, inviteDevice);
    const outcomes = await Promise.allSettled([
      service.replacePins(user.id, device, hash(session.token), {
        currentPin: "111111",
        pins: ["333333"],
      }),
      service.completeOnboarding(inviteDevice, {
        invitationToken,
        pins: ["333333"],
        handle: "new_user",
        name: "新账号",
      }),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const failure = outcomes.find((outcome) => outcome.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason).toMatchObject({
      code: "E_CONFLICT",
    });
    const login = await service.loginAsync(service.registerDevice(), "333333");
    expect("user" in login).toBe(true);
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM user_pins")!.n).toBe(
      service.repo.countUsers(),
    );
  });

  it("rejects a PIN change if its authorizing session is revoked during hashing", async () => {
    const { service } = setup();
    const user = service.createUser({ pin: "111111", name: "账号" });
    const device = service.registerDevice();
    const session = service.login(device, "111111");
    const changing = service.replacePins(user.id, device, hash(session.token), {
      currentPin: "111111",
      pins: ["222222"],
    });
    service.revoke(hash(session.token));
    await expect(changing).rejects.toMatchObject({ code: "E_UNAUTHENTICATED" });
    expect(service.login(device, "111111").user.id).toBe(user.id);
    expect(() => service.login(device, "222222")).toThrow();
  });

  it("never resurrects a replaced legacy PIN when its lazy hash upgrade finishes late", async () => {
    const { db, service } = setup();
    const user = service.createUser({ pin: "111111", name: "旧账号" });
    const device = service.registerDevice();
    const session = service.login(device, "111111");
    const legacy = createHmac(
      "sha256",
      Buffer.from(service.credentials.secret()!, "hex"),
    )
      .update("111111")
      .digest("hex");
    db.run(
      "UPDATE user_pins SET hash=?,salt=NULL,verifier=NULL WHERE user_id=?",
      legacy,
      user.id,
    );
    const entered = deferred<void>();
    const release = deferred<void>();
    const original = PinCredentials.prototype.createAsync;
    vi.spyOn(PinCredentials.prototype, "createAsync").mockImplementation(
      async function (this: PinCredentials, pin: string) {
        if (pin === "111111") {
          entered.resolve();
          await release.promise;
        }
        return original.call(this, pin);
      },
    );
    const login = service.loginAsync(service.registerDevice(), "111111");
    // Observe rejection immediately even if an implementation rejects before release.
    const outcome = Promise.allSettled([login]);
    await entered.promise;
    try {
      await service.replacePins(user.id, device, hash(session.token), {
        currentPin: "111111",
        pins: ["222222"],
      });
    } finally {
      release.resolve();
    }
    expect((await outcome)[0]).toMatchObject({
      status: "rejected",
      reason: { code: "E_UNAUTHENTICATED" },
    });
    expect(() => service.login(device, "111111")).toThrow();
    expect(service.login(device, "222222").user.id).toBe(user.id);
  });
});
