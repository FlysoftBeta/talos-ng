import { AppError } from "@talos/base";
import { describe, expect, it, vi } from "vitest";
import { preferenceRows, preferenceValue } from "./preferences.ts";
import { PinReplacementController } from "./pin-replacement.ts";
import { ProfileController, canSaveProfile } from "./profile.ts";
import { SettingsController, confirmDialog } from "./settings-sheet.ts";
import type { SettingsPort } from "./settings-sheet.ts";

const port = (over: Partial<SettingsPort> = {}): SettingsPort => ({
  can: () => ({ ok: true }),
  setSetting: vi.fn(async () => {}),
  estimateStorage: vi.fn(async () => {}),
  localOperationCount: vi.fn(async () => 3),
  resetLocalData: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  ...over,
});

describe("preferences", () => {
  it("maps option values to stored values and reads marks", () => {
    expect(preferenceValue("idleLockMinutes", "15")).toBe(15);
    expect(preferenceValue("doNotDisturb", "on")).toBe(true);
    expect(preferenceValue("theme", "dark")).toBe("dark");
    const rows = preferenceRows({
      setting: <T>(key: string, fallback: T) =>
        (key === "idleLockMinutes" ? 0 : fallback) as T,
      settingMark: (key) => (key === "theme" ? "pending" : undefined),
    });
    expect(rows.map((row) => row.value)).toEqual([
      "system",
      "normal",
      "0",
      "off",
    ]);
    expect(rows[0]!.mark).toEqual({ state: "pending", label: "待同步" });
  });
});

describe("SettingsController", () => {
  it("saves only with permission and reports failures", async () => {
    const denied = port({ can: () => ({ ok: false, reason: "r" }) });
    new SettingsController(denied).choose("theme", "dark");
    expect(denied.setSetting).not.toHaveBeenCalled();
    const failing = port({
      setSetting: async () => Promise.reject(new Error("x")),
    });
    const settings = new SettingsController(failing);
    settings.choose("doNotDisturb", "on");
    await vi.waitFor(() =>
      expect(settings.getState().error).toBe("无法保存更改，请重试"),
    );
  });
  it("reads unsynced operations before the reset dialog and reports a blocked reset", async () => {
    const p = port({
      resetLocalData: vi.fn(async (blocked?: () => void) => blocked?.()),
    });
    const settings = new SettingsController(p);
    settings.openReset();
    await vi.waitFor(() => expect(settings.getState().sheet).toBe("reset"));
    expect(settings.getState().allOperations).toBe(3);
    await settings.confirm();
    expect(settings.getState().error).toContain("关闭其他 Talos II 标签页");
    expect(settings.getState().sheet).toBeUndefined();
  });
  it("keeps the dialog open with the server message when logout fails; busy blocks dismissal", async () => {
    let reject!: (e: Error) => void;
    const p = port({
      logout: () => new Promise<void>((_, r) => (reject = r)),
    });
    const settings = new SettingsController(p);
    settings.openLogout();
    const done = settings.confirm();
    settings.dismissConfirmation();
    expect(settings.getState().sheet).toBe("logout");
    reject(new AppError("E_INTERNAL", "无法退出"));
    await done;
    expect(settings.getState()).toMatchObject({
      sheet: "logout",
      busy: false,
      error: "无法退出",
    });
  });
  it("words the reset warning only when operations are unsynced", () => {
    expect(confirmDialog("reset", "x", false, 2).warning).toContain("2 项");
    expect(confirmDialog("reset", "x", false, 0).warning).toBeUndefined();
    expect(confirmDialog("logout", undefined, true, 5)).toMatchObject({
      title: "退出「当前账号」？",
      warning: undefined,
      confirmLabel: "正在处理…",
    });
  });
});

describe("ProfileController", () => {
  it("sanitises the handle, trims the name and gates saving on a real change", async () => {
    const updateProfile = vi.fn(async () => {});
    const user = { handle: "lin", name: "林" };
    const profile = new ProfileController({ updateProfile }, user);
    expect(canSaveProfile(profile.getState(), user, true)).toBe(false);
    profile.setHandle("l-i n2");
    profile.setName(" 林同学 ");
    expect(canSaveProfile(profile.getState(), user, false)).toBe(false);
    expect(canSaveProfile(profile.getState(), user, true)).toBe(true);
    await profile.save();
    expect(updateProfile).toHaveBeenCalledExactlyOnceWith({
      handle: "lin2",
      name: "林同学",
    });
    expect(profile.getState().message).toBe("个人资料已保存");
  });
});

describe("PinReplacementController", () => {
  it("walks current, new and second PIN, then completes", async () => {
    const replacePins = vi.fn(async () => {});
    const flow = new PinReplacementController({ replacePins });
    flow.enterPin("000000");
    flow.enterPin("111111");
    expect(flow.getState().step).toBe("choice");
    flow.addSecondPin();
    flow.enterPin("111111");
    expect(flow.getState()).toMatchObject({
      step: "second",
      error: "两个 PIN 必须不同",
    });
    flow.enterPin("222222");
    await vi.waitFor(() => expect(flow.getState().step).toBe("done"));
    expect(replacePins).toHaveBeenCalledExactlyOnceWith("000000", [
      "111111",
      "222222",
    ]);
  });
  it("returns to the first step after a rejected replacement", async () => {
    const flow = new PinReplacementController({
      replacePins: async () =>
        Promise.reject(new AppError("E_INTERNAL", "当前 PIN 错误")),
    });
    flow.enterPin("000000");
    flow.enterPin("111111");
    flow.useSinglePin();
    await vi.waitFor(() => expect(flow.getState().busy).toBe(false));
    expect(flow.getState()).toMatchObject({
      step: "current",
      error: "当前 PIN 错误",
    });
  });
});
