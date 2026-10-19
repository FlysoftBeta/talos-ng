import { describe, expect, it, vi } from "vitest";
import { contract } from "@talos/contract";
import type { Method } from "@talos/contract";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import { BackupController } from "./backup.ts";
import { HostController, delayText } from "./host.ts";
import { OfficeController } from "./office.ts";
import type { OpsPort } from "./port.ts";
import { UPLOAD_SLICE, UpdateController } from "./update.ts";
import type { UploadSource } from "./update.ts";

const ops = contract.ops;
const settings = {
  retention: 5,
  daily: true,
  cloudEnabled: false,
  autoCheck: false,
  manifestUrl: "https://u.example/m.json",
};
const status = {
  build: "1",
  phase: "idle",
  candidate: null,
  progress: 0,
  lastError: null,
  launcher: true,
};
const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

interface Rig {
  port: OpsPort;
  calls: { name: string; args: unknown }[];
  setAccess(value: (method: Method) => Capability): void;
  notify(): void;
  handler: Map<string, (args: unknown) => unknown>;
}
function rig(): Rig {
  let access: (method: Method) => Capability = () => ({ ok: true });
  const listeners = new Set<() => void>(),
    calls: Rig["calls"] = [],
    handler = new Map<string, (args: unknown) => unknown>();
  handler.set("ops.settings.get", () => settings);
  handler.set("ops.update.status", () => status);
  handler.set("ops.host.status", () => ({ available: true, shutdownAt: null }));
  handler.set("ops.backup.list", () => [{ id, created: 1, size: 1048576 }]);
  handler.set("ops.office.list", () => ({ available: true, files: [] }));
  handler.set("ops.office.refresh", () => ({ available: true, files: [] }));
  handler.set("ops.backup.create", () => ({ id, created: 1, size: 1 }));
  handler.set("ops.backup.download", () => ({
    ticket: "t",
    url: "/d/1",
    expires: 1,
  }));
  handler.set("ops.settings.set", () => settings);
  for (const name of ["stage", "check", "install"])
    handler.set(`ops.update.${name}`, () => status);
  for (const name of [
    "ops.update.apply",
    "ops.update.confirm",
    "ops.office.clear",
    "ops.backup.delete",
    "upload.abort",
  ])
    handler.set(name, () => ({ ok: true }));
  handler.set("ops.host.run", (args) => ({
    available: true,
    shutdownAt:
      (args as { action: string }).action === "shutdown" ? 5_000_000 : null,
  }));
  handler.set("upload.commit", () => ({
    id,
    object: { id: "a".repeat(64), size: 1 },
  }));
  const port = {
    can: (method: Method) => access(method),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    command: async (method: Method, args: unknown) => {
      calls.push({ name: method.name, args });
      const result = handler.get(method.name)?.(args);
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as OpsPort;
  return {
    port,
    calls,
    handler,
    setAccess: (value) => {
      access = value;
    },
    notify: () => listeners.forEach((l) => l()),
  };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const names = (r: Rig) => r.calls.map((c) => c.name);

describe("ops panel controllers", () => {
  it("requests nothing while denied and loads when the permission arrives", async () => {
    const r = rig();
    r.setAccess(() => ({ ok: false, reason: "此操作需要连接服务器" }));
    const host = new HostController(r.port);
    host.attach();
    await flush();
    expect(r.calls).toEqual([]);
    expect(host.model().frame.status).toBe("offline");
    expect(host.model().frame.reason).toBe("此操作需要连接服务器");
    r.setAccess(() => ({ ok: true }));
    r.notify();
    await flush();
    expect(names(r)).toEqual(["ops.host.status"]);
    expect(host.model().frame.status).toBe("ready");
    expect(host.model().platform).toBe("Windows · 可用");
    host.detach();
  });

  it("requires confirmation, runs once and ignores presses while denied", async () => {
    const r = rig(),
      host = new HostController(r.port);
    host.attach();
    await flush();
    await host.press("shutdown");
    expect(names(r)).toEqual(["ops.host.status"]);
    expect(host.action("shutdown").open).toBe(true);
    host.dismiss("shutdown");
    expect(host.action("shutdown").open).toBe(false);
    await host.press("shutdown");
    await host.confirm("shutdown");
    expect(r.calls.at(-1)).toEqual({
      name: "ops.host.run",
      args: { action: "shutdown", delayMinutes: 0 },
    });
    expect(host.action("shutdown")).toMatchObject({ busy: false, open: false });
    r.setAccess((m) =>
      m === ops.host.run
        ? { ok: false, reason: "当前账号未获授权" }
        : { ok: true },
    );
    r.notify();
    const before = r.calls.length;
    await host.confirm("shutdown");
    expect(r.calls.length).toBe(before);
    expect(host.action("shutdown").reason).toBe("当前账号未获授权");
  });

  it("shows a failure and allows a retry; a platform without support disables host actions", async () => {
    const r = rig();
    r.handler.set("ops.host.status", () => ({
      available: false,
      shutdownAt: null,
    }));
    const host = new HostController(r.port);
    host.attach();
    await flush();
    expect(host.action("reset-classroom").reason).toBe("仅支持 Windows");
    const office = new OfficeController(r.port, { download: vi.fn() });
    r.handler.set("ops.office.refresh", () => new Error("捕获失败"));
    r.handler.set("ops.office.list", () => ({ available: true, files: [] }));
    office.attach();
    await flush();
    await office.press("capture");
    expect(office.action("capture").error).toBe("捕获失败");
    r.handler.set("ops.office.refresh", () => ({ available: true, files: [] }));
    await office.press("capture");
    expect(office.action("capture").error).toBeUndefined();
  });

  it("schedules a shutdown with the chosen delay and offers to cancel only what is pending", async () => {
    const r = rig(),
      host = new HostController(r.port);
    host.attach();
    await flush();
    expect(host.model().cancel.reason).toBe("没有待执行的关机");
    host.setDelay(0);
    expect(host.model().schedule.reason).toBe("请选择关机时间");
    host.setDelay(90);
    expect(host.model().schedule.confirm).toBe(
      "在 1 小时 30 分钟后关闭服务器计算机",
    );
    await host.press("schedule");
    await host.confirm("schedule");
    expect(r.calls.at(-1)).toEqual({
      name: "ops.host.run",
      args: { action: "shutdown", delayMinutes: 90 },
    });
    expect(host.model().scheduled).toContain("关机");
    expect(host.model().cancel.reason).toBeUndefined();
    await host.press("cancel");
    expect(r.calls.at(-1)).toEqual({
      name: "ops.host.run",
      args: { action: "cancel-shutdown" },
    });
    expect(host.model().scheduled).toBeUndefined();
    expect(delayText(45)).toBe("45 分钟");
    expect(delayText(120)).toBe("2 小时");
  });

  it("keeps the newest answer when an older reload resolves late", async () => {
    const r = rig();
    const resolvers: ((value: unknown) => void)[] = [];
    r.handler.set(
      "ops.backup.list",
      () => new Promise((resolve) => resolvers.push(resolve)) as never,
    );
    // The fake awaits promises returned by handlers.
    const port: OpsPort = {
      ...r.port,
      command: (async (method: Method, args: unknown) =>
        await (r.handler.get(method.name)?.(args) ?? {})) as OpsPort["command"],
    };
    const backup = new BackupController(port, { download: vi.fn() });
    backup.attach();
    await flush();
    await backup.press("refresh");
    await flush();
    expect(resolvers.length).toBeGreaterThanOrEqual(2);
    const [first, second] = resolvers.slice(-2) as [
      (value: unknown) => void,
      (value: unknown) => void,
    ];
    second([{ id, created: 2, size: 2097152 }]);
    await flush();
    first([]);
    await flush();
    expect(backup.model().rows).toHaveLength(1);
    expect(backup.model().rows?.[0]?.hint).toContain("2.0 MiB");
  });

  it("saves backup settings from the draft and resets the draft when the server value changes", async () => {
    const r = rig(),
      backup = new BackupController(r.port, { download: vi.fn() });
    backup.attach();
    await flush();
    expect(backup.model().settings?.draft).toEqual({
      retention: 5,
      daily: true,
    });
    backup.setRetention(9);
    backup.setDaily(false);
    await backup.press("save-settings");
    expect(r.calls.find((c) => c.name === "ops.settings.set")?.args).toEqual({
      ...settings,
      retention: 9,
      daily: false,
    });
    r.handler.set("ops.settings.get", () => ({
      ...settings,
      retention: 9,
      daily: false,
    }));
    await flush();
    expect(backup.model().settings?.draft).toEqual({
      retention: 9,
      daily: false,
    });
  });

  it("downloads and deletes a backup through the named actions", async () => {
    const r = rig(),
      download = vi.fn();
    r.handler.set("ops.backup.download", () => ({
      ticket: "t",
      url: "/d/1",
      expires: 1,
    }));
    const backup = new BackupController(r.port, { download });
    backup.attach();
    await flush();
    await backup.press(`download:${id}`);
    expect(download).toHaveBeenCalledWith("/d/1");
    await backup.press(`delete:${id}`);
    expect(names(r)).not.toContain("ops.backup.delete");
    expect(backup.action(`delete:${id}`).confirm).toBe(`删除备份 ${id}`);
    await backup.confirm(`delete:${id}`);
    expect(r.calls.find((c) => c.name === "ops.backup.delete")?.args).toEqual({
      id,
    });
  });
});

describe("update upload sequence", () => {
  const source = (size: number): UploadSource => ({
    size,
    slice: async (start, end) => new Uint8Array(Math.min(end, size) - start),
  });
  const upload = (r: Rig) => {
    r.handler.set("upload.begin", () => ({ id, offset: 0 }));
    r.handler.set("upload.append", (args) => ({
      offset: Math.min(
        (args as { offset: number }).offset + UPLOAD_SLICE,
        size,
      ),
    }));
  };
  let size = UPLOAD_SLICE * 2 + 10;

  it("streams slices, commits, stages and refreshes the status", async () => {
    const r = rig();
    size = UPLOAD_SLICE * 2 + 10;
    upload(r);
    const update = new UpdateController(r.port);
    update.attach();
    await flush();
    expect(update.action("stage").reason).toBe("请先选择更新包");
    update.setFile(source(size));
    expect(update.action("stage").reason).toBeUndefined();
    await update.press("stage");
    const sequence = names(r).filter(
      (n) => n.startsWith("upload.") || n === "ops.update.stage",
    );
    expect(sequence).toEqual([
      "upload.begin",
      "upload.append",
      "upload.append",
      "upload.append",
      "upload.commit",
      "ops.update.stage",
    ]);
    expect(update.model().progressPercent).toBe(100);
    expect(names(r).filter((n) => n === "ops.update.status")).toHaveLength(2);
  });

  it("aborts the upload when a slice fails and reports the failure", async () => {
    const r = rig();
    size = UPLOAD_SLICE * 2;
    upload(r);
    let appends = 0;
    r.handler.set("upload.append", () => {
      if (++appends === 2) return new Error("网络中断");
      return { offset: UPLOAD_SLICE };
    });
    const update = new UpdateController(r.port);
    update.attach();
    await flush();
    update.setFile(source(size));
    await update.press("stage");
    expect(names(r)).toContain("upload.abort");
    expect(names(r)).not.toContain("upload.commit");
    expect(names(r)).not.toContain("ops.update.stage");
    expect(update.action("stage").error).toBe("网络中断");
  });

  it("gates apply and confirm on the update phase and needs the launcher to stage", async () => {
    const r = rig();
    r.handler.set("ops.update.status", () => ({
      ...status,
      launcher: false,
      phase: "staged",
      candidate: "2",
    }));
    const update = new UpdateController(r.port);
    update.attach();
    await flush();
    update.setFile(source(1));
    expect(update.action("stage").reason).toBe("请通过启动器运行");
    expect(update.action("apply").reason).toBeUndefined();
    expect(update.action("apply").confirm).toBe("应用版本 2 并重启服务器");
    expect(update.action("confirm").reason).toBe("没有待确认的版本");
    expect(update.model().tags).toEqual(["当前 1", "已准备", "候选 2"]);
  });

  it("toggles cloud updates with the edited manifest address", async () => {
    const r = rig(),
      update = new UpdateController(r.port);
    update.attach();
    await flush();
    update.setManifestUrl("https://new.example/m.json");
    expect(update.model().cloud?.toggle.label).toBe("保存并开启云端更新");
    await update.press("cloud-toggle");
    expect(r.calls.find((c) => c.name === "ops.settings.set")?.args).toEqual({
      ...settings,
      manifestUrl: "https://new.example/m.json",
      cloudEnabled: true,
    });
  });
});
