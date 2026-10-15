import { describe, expect, it, vi } from "vitest";
import { LogoutController, retryCountdown } from "./device-locked.ts";
import { InvitationController } from "./invitation.ts";
import { OnboardingController, canSubmitOnboarding } from "./onboarding.ts";
import { PinEntryController, nextPin } from "./pin-entry.ts";

describe("PinEntryController", () => {
  it("completes on the sixth digit and clears before the callback", () => {
    const onComplete = vi.fn();
    const pin = new PinEntryController();
    pin.configure({ busy: false, onComplete });
    for (const key of "12345") pin.press(key);
    expect(pin.getState().length).toBe(5);
    pin.press("6");
    expect(onComplete).toHaveBeenCalledExactlyOnceWith("123456");
    expect(pin.getState().length).toBe(0);
  });
  it("ignores keys while busy and supports erase keys", () => {
    const onComplete = vi.fn();
    const pin = new PinEntryController();
    pin.configure({ busy: true, onComplete });
    pin.press("1");
    expect(pin.getState().length).toBe(0);
    pin.configure({ busy: false, onComplete });
    pin.press("1");
    pin.press("2");
    pin.press("退格");
    expect(pin.getState().length).toBe(1);
    pin.press("Delete");
    expect(pin.getState().length).toBe(0);
    expect(nextPin("123", "x")).toBe("123");
  });
});

describe("OnboardingController", () => {
  it("requires distinct PINs, offers a single-PIN path and submits trimmed fields", () => {
    const onboard = vi.fn(async () => true);
    const flow = new OnboardingController({ onboard });
    flow.enterPin("111111");
    expect(flow.getState().step).toBe("choice");
    flow.addSecondPin();
    flow.enterPin("111111");
    expect(flow.getState().error).toBe("两个 PIN 必须不同");
    expect(flow.getState().step).toBe("second");
    flow.enterPin("222222");
    expect(flow.getState()).toMatchObject({
      step: "profile",
      error: undefined,
    });
    flow.setHandle("a-b c_1");
    flow.setName("  林同学 ");
    expect(flow.getState().handle).toBe("abc_1");
    flow.submit(false);
    expect(onboard).not.toHaveBeenCalled();
    flow.submit(true);
    expect(onboard).toHaveBeenCalledExactlyOnceWith({
      pins: ["111111", "222222"],
      handle: "abc_1",
      name: "林同学",
    });
  });
  it("restart discards PINs and submit needs a connection", () => {
    const flow = new OnboardingController({ onboard: async () => true });
    flow.enterPin("111111");
    flow.useSinglePin();
    flow.restart();
    expect(flow.getState()).toMatchObject({ step: "first", pins: [] });
    expect(canSubmitOnboarding({ handle: "a", name: " " }, true, false)).toBe(
      false,
    );
    expect(canSubmitOnboarding({ handle: "a", name: "b" }, false, false)).toBe(
      false,
    );
    expect(canSubmitOnboarding({ handle: "a", name: "b" }, true, false)).toBe(
      true,
    );
  });
});

describe("device-locked rules", () => {
  it("counts down only throttling and timed bans", () => {
    expect(
      retryCountdown({ reason: "throttled", retryAt: 2000 }, 0),
    ).toMatchObject({
      visible: true,
      seconds: 2,
      label: "2 秒后可重试",
    });
    expect(
      retryCountdown({ reason: "throttled", retryAt: 2000 }, 2000).label,
    ).toBe("现在可以重试");
    expect(retryCountdown({ reason: "banned" }, 0).visible).toBe(false);
    expect(retryCountdown({ reason: "system-lock" }, 0).visible).toBe(false);
  });
  it("logout needs confirmation, cannot be dismissed while running and reports failure", async () => {
    let fail = true;
    const run = vi.fn(async () => {
      if (fail) throw new Error("offline");
    });
    const logout = new LogoutController(run);
    logout.ask();
    logout.confirm();
    logout.cancel();
    expect(logout.getState().confirming).toBe(true);
    await vi.waitFor(() => expect(logout.getState().busy).toBe(false));
    expect(logout.getState().error).toBe("offline");
    fail = false;
    logout.confirm();
    await vi.waitFor(() => expect(logout.getState().confirming).toBe(false));
    expect(logout.getState().error).toBeUndefined();
  });
});

describe("InvitationController", () => {
  it("keeps the last invitation when a retry fails", async () => {
    const createInvitation = vi
      .fn()
      .mockResolvedValueOnce({ id: "i", pin: "123456", expires: 1 })
      .mockRejectedValueOnce(new Error("x"));
    const invitations = new InvitationController({ createInvitation });
    await invitations.create();
    expect(invitations.getState().invitation?.pin).toBe("123456");
    await invitations.create();
    expect(invitations.getState()).toMatchObject({
      busy: false,
      error: "无法创建邀请，请重试",
      invitation: { pin: "123456" },
    });
  });
});
