import type { Method } from "@talos/contract";
import { describe, expect, it, vi } from "vitest";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import { AnnouncementsController } from "./announcements.ts";
import { CreditBatchController } from "./credit-batch.ts";
import { DevicesController } from "./devices.ts";
import { GroupsController } from "./groups.ts";
import {
  IncidentsController,
  incidentQuery,
  emptyIncidentFilters,
} from "./incidents.ts";
import { InvitationsController } from "./invitations.ts";
import { SystemController } from "./system.ts";
import {
  UsersController,
  toggledRoles,
  userUpdate,
  usersAccess,
} from "./users.ts";
import {
  BUILT_IN_SECTIONS,
  allowedSections,
  currentSection,
  workbenchContent,
} from "./workbench.ts";

const ulid = (n: number): string =>
  `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, "0")}`;
const SELF = ulid(99);
const settled = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

type Args = Record<string, unknown>;
interface Call {
  method: string;
  args: Args;
}
/** Command port double: `answer` replies by method name and may throw to simulate a failure. */
function fakePort(
  answer: (method: string, args: Args) => unknown,
  options: { roles?: string[]; can?: Capability } = {},
) {
  const calls: Call[] = [];
  const listeners = new Set<() => void>();
  let roles = options.roles ?? ["root"];
  return {
    calls,
    command: vi.fn(async (method: Method, args: Args) => {
      calls.push({ method: method.name, args });
      return answer(method.name, args);
    }),
    can: (): Capability => options.can ?? { ok: true },
    operation: () => ({ op: `op-${calls.length}`, t: { ms: 0, counter: 0 } }),
    getSnapshot: () => ({ user: { id: SELF, roles } }) as never,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    time: () => 1_000_000,
    createInvitation: vi.fn(),
    setRoles(next: string[]) {
      roles = next;
      listeners.forEach((listener) => listener());
    },
    last: (name: string) => [...calls].reverse().find((c) => c.method === name),
    count: (name: string) => calls.filter((c) => c.method === name).length,
  };
}
const user = (n: number, extra: object = {}) => ({
  id: ulid(n),
  handle: `user${n}`,
  name: `用户${n}`,
  roles: [],
  features: [],
  mutedUntil: 0,
  banned: false,
  bannedUntil: null,
  deactivated: false,
  created: 1,
  ...extra,
});
const group = (n: number, extra: object = {}) => ({
  id: ulid(n),
  handle: `g${n}`,
  name: `群${n}`,
  type: "normal",
  memberCount: 2,
  parent: null,
  owner: ulid(1),
  discoverable: false,
  membersHidden: false,
  adminOnly: false,
  noLeave: false,
  passwordRequired: false,
  ...extra,
});
const page = (items: unknown[]) => ({ items, total: items.length });
const OK = { ok: true };
const settings = {
  whitelist: false,
  systemLock: false,
  idleLock: false,
  identitySignals: ["clientId"],
  maxVolume: 1,
};
const deviceRow = (n: number, extra: object = {}) => ({
  id: ulid(n),
  label: "",
  lastSeen: 1,
  whitelisted: false,
  locked: false,
  boundUser: null,
  persistent: false,
  ...extra,
});
/** Schema-valid replies for commands whose result the test does not inspect. */
const defaults = (method: string): unknown =>
  ({
    "admin.user.update": { user: user(1) },
    "admin.user.create": { user: user(1) },
    "admin.group.update": { group: group(1) },
    "admin.group.create": { group: group(1) },
    "admin.device.update": { device: deviceRow(1) },
    "admin.device.policy.set": settings,
    "admin.settings.set": settings,
    "admin.announcement.publish": {
      announcement: {
        id: "current",
        revision: 1,
        title: "t",
        text: "x",
        published: 1,
      },
    },
    "admin.incident.selfTest": { id: ulid(1) },
  })[method] ?? OK;

describe("users", () => {
  const answer = (method: string) =>
    method === "admin.user.list"
      ? page([user(1), user(2)])
      : method === "admin.user.bulk"
        ? {
            results: [
              { id: ulid(1), ok: true },
              { id: ulid(2), ok: false, error: "已是根" },
            ],
          }
        : {};

  it("pages from the first row, resets to page one on search and ignores unknown sort columns", async () => {
    const port = fakePort(answer);
    const users = new UsersController(port as never);
    users.attach();
    await settled();
    expect(port.last("admin.user.list")!.args).toEqual({
      query: "",
      offset: 0,
      limit: 50,
      sort: "handle",
    });
    users.setPage(2);
    users.setQuery("ab");
    users.sortBy("roles");
    users.sortBy("name");
    await settled();
    expect(port.last("admin.user.list")!.args).toEqual({
      query: "ab",
      offset: 0,
      limit: 50,
      sort: "name",
    });
    users.detach();
  });

  it("sends a restriction only after confirmation and permanent bans have no deadline", async () => {
    const port = fakePort(answer);
    const users = new UsersController(port as never);
    users.attach();
    await settled();
    users.askBan(user(1) as never);
    users.setDuration(0);
    users.confirmBan();
    expect(port.count("admin.user.update")).toBe(0);
    expect(users.getState().confirm?.label).toBe("封禁：用户1（user1）");
    users.runConfirmed();
    await settled();
    expect(port.last("admin.user.update")!.args).toEqual({
      id: ulid(1),
      banned: true,
      bannedUntil: null,
    });
    users.setDuration(60);
    users.askMute(user(2) as never);
    users.confirmMute();
    users.runConfirmed();
    await settled();
    expect(port.last("admin.user.update")!.args).toEqual({
      id: ulid(2),
      mutedUntil: 1_000_000 + 3_600_000,
    });
    users.detach();
  });

  it("offers unban and unmute directly and shows a failed confirmed command", async () => {
    const port = fakePort((method) => {
      if (method === "admin.user.purge") throw new Error("仍有未完成任务");
      return answer(method);
    });
    const users = new UsersController(port as never);
    users.askBan(user(1, { banned: true }) as never);
    expect(users.getState().banning).toBeNull();
    expect(users.getState().confirm?.label).toBe("解封：用户1（user1）");
    users.dismissConfirm();
    users.askMute(user(1, { mutedUntil: 2_000_000 }) as never);
    expect(users.getState().confirm?.label).toBe("解除禁言：用户1（user1）");
    users.dismissConfirm();
    users.runConfirmed();
    expect(port.count("admin.user.update")).toBe(0);
    users.purge(user(2) as never);
    users.runConfirmed();
    await settled();
    expect(users.getState().error).toBe("仍有未完成任务");
  });

  it("sends only the changed fields the account may manage and assigns discipline separately", async () => {
    const target = user(1, {
      roles: ["administrator"],
      features: ["ai"],
    }) as never;
    const community = usersAccess(
      { id: SELF, roles: ["community_manager"] },
      () => ({ ok: true }),
    );
    const draft = {
      handle: "renamed",
      name: "用户1",
      pin: "123456",
      roles: [],
      features: [],
    };
    expect(userUpdate(target, draft, community)).toEqual({
      id: ulid(1),
      pin: "123456",
    });
    const root = usersAccess({ id: SELF, roles: ["root"] }, () => ({
      ok: true,
    }));
    expect(
      userUpdate(
        target,
        { ...draft, roles: ["administrator"], features: ["ai"] },
        root,
      ),
    ).toEqual({
      id: ulid(1),
      handle: "renamed",
      name: "用户1",
      pin: "123456",
    });
    const port = fakePort(answer);
    const users = new UsersController(port as never);
    users.begin(target);
    users.setDiscipline("enable");
    await users.save();
    expect(port.count("admin.user.update")).toBe(0);
    expect(port.last("learning.discipline.assign")!.args).toEqual({
      user: ulid(1),
      enabled: true,
    });
    expect(users.getState().editing).toBeNull();
  });

  it("adding a role adds its dependencies and removing one removes its dependants", () => {
    expect(toggledRoles([], "advanced_community_manager", true)).toEqual([
      "administrator",
      "community_manager",
      "advanced_community_manager",
    ]);
    expect(
      toggledRoles(
        ["administrator", "community_manager", "advanced_community_manager"],
        "community_manager",
        false,
      ),
    ).toEqual(["administrator"]);
  });

  it("keeps the per-user report after a bulk edit and clears the selection", async () => {
    const port = fakePort(answer);
    const users = new UsersController(port as never);
    users.setSelected(new Set([ulid(1), ulid(2)]));
    users.setGate("ai", "enable");
    expect(users.canApplyBulk()).toBe(true);
    users.openBulk();
    users.applyBulk();
    expect(users.getState().confirm?.label).toBe("修改 2 位用户");
    users.runConfirmed();
    await settled();
    expect(port.last("admin.user.bulk")!.args).toEqual({
      ids: [ulid(1), ulid(2)],
      gateChanges: { ai: "enable" },
    });
    expect(users.getState()).toMatchObject({ bulkOpen: false });
    expect(users.getState().report).toHaveLength(2);
    expect(users.getState().selected.size).toBe(0);
  });

  it("follows role changes of the signed-in account", async () => {
    const port = fakePort(answer, { roles: ["community_manager"] });
    const users = new UsersController(port as never);
    users.attach();
    expect(users.getState().access.features).toBe(false);
    port.setRoles(["feature_manager"]);
    expect(users.getState().access.features).toBe(true);
    users.detach();
  });
});

describe("credit batch", () => {
  it("retries only failed users with their original keys and keeps earlier successes", async () => {
    let lost = true;
    const port = fakePort((_method, args) => {
      if (args.user === "b" && lost) {
        lost = false;
        throw new Error("连接中断");
      }
      return OK;
    });
    const batch = new CreditBatchController(
      port as never,
      ["a", "b", "c"],
      () => {},
    );
    batch.setAmount("2.5");
    batch.setDays("30");
    await batch.run();
    expect(batch.getState().results!.map((r) => r.ok)).toEqual([
      true,
      false,
      true,
    ]);
    const keys = port.calls.map((c) => c.args.key);
    expect(port.calls[0]!.args).toMatchObject({
      user: "a",
      amount: 2_500_000,
      days: 30,
    });
    expect(batch.canRun()).toBe(true);
    await batch.run();
    expect(port.calls.map((c) => c.args.user)).toEqual(["a", "b", "c", "b"]);
    expect(port.calls[3]!.args.key).toBe(keys[1]);
    expect(batch.getState().results!.every((r) => r.ok)).toBe(true);
    expect(batch.canRun()).toBe(false);
  });
  it("needs a positive recharge or plan and cannot be closed while running", async () => {
    const closed = vi.fn();
    let release!: () => void;
    const port = fakePort(() => new Promise((r) => (release = () => r(OK))));
    const batch = new CreditBatchController(port as never, ["a"], closed);
    expect(batch.canRun()).toBe(false);
    batch.setDays("4000");
    expect(batch.canRun()).toBe(false);
    batch.setDays("1");
    expect(batch.canRun()).toBe(true);
    const running = batch.run();
    batch.close();
    expect(closed).not.toHaveBeenCalled();
    release();
    await running;
    batch.close();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});

describe("groups", () => {
  const answer = (method: string, args: Args) => {
    if (method === "admin.group.list")
      return page([group(1), group(2, { type: "wild" })]);
    if (method === "admin.group.members") return [];
    if (method === "admin.user.list") return page([user(5, { handle: "Lin" })]);
    if (method === "admin.group.member" && args.user === ulid(8))
      throw new Error("不能移除群主");
    return defaults(method);
  };
  it("removes the selection one by one, reports each failure and clears the selection", async () => {
    const port = fakePort(answer);
    const groups = new GroupsController(port as never);
    groups.attach();
    await settled();
    groups.openMembers(group(1) as never);
    groups.setSelectedMembers(new Set([ulid(7), ulid(8)]));
    groups.askRemoveSelected();
    expect(groups.getState().confirm?.label).toBe("群1的 2 名成员");
    groups.runConfirmed();
    await settled();
    expect(
      port.calls
        .filter((c) => c.method === "admin.group.member")
        .map((c) => c.args.operation),
    ).toEqual(["kick", "kick"]);
    expect(groups.getState().error).toBe(`${ulid(8)}: 不能移除群主`);
    expect(groups.getState().selectedMembers.size).toBe(0);
  });
  it("adds a member only for an exact, case-insensitive handle match", async () => {
    const port = fakePort(answer);
    const groups = new GroupsController(port as never);
    groups.openMembers(group(1) as never);
    groups.setHandle("li");
    await settled();
    expect(groups.canAddMember()).toBe(false);
    groups.setHandle("lin");
    await settled();
    expect(groups.canAddMember()).toBe(true);
    groups.addExact();
    await settled();
    expect(port.last("admin.group.member")!.args).toEqual({
      id: ulid(1),
      user: ulid(5),
      operation: "add",
    });
  });
  it("keeps reserved groups' parent unchanged and clears or replaces the password", async () => {
    const port = fakePort(answer);
    const groups = new GroupsController(port as never);
    groups.attach();
    await settled();
    groups.edit(group(2, { type: "wild", parent: ulid(1) }) as never);
    expect(groups.editorKind()).toBe("system");
    groups.change({ clearPassword: true });
    groups.save();
    await settled();
    expect(port.last("admin.group.update")!.args).not.toHaveProperty("parent");
    expect(port.last("admin.group.update")!.args).toMatchObject({
      password: "",
    });
    expect(groups.getState().editor).toBeUndefined();
    groups.create();
    expect(groups.canSave()).toBe(false);
    groups.change({ name: "新群", password: "pw" });
    groups.save();
    await settled();
    expect(port.last("admin.group.create")!.args).toMatchObject({
      name: "新群",
      parent: null,
      password: "pw",
    });
  });
});

describe("devices", () => {
  const device = deviceRow;
  const answer = (method: string) =>
    method === "admin.device.list"
      ? page([device(1)])
      : method === "admin.device.policy.get"
        ? settings
        : defaults(method);
  it("never removes the last identity signal; other changes wait for confirmation", async () => {
    const port = fakePort(answer);
    const devices = new DevicesController(port as never);
    devices.attach();
    await settled();
    devices.toggleSignal("clientId");
    expect(devices.getState().error).toBe("至少保留一个设备识别信号");
    expect(devices.getState().confirm).toBeUndefined();
    devices.toggleSignal("ip");
    expect(port.count("admin.device.policy.set")).toBe(0);
    devices.runConfirmed();
    await settled();
    expect(port.last("admin.device.policy.set")!.args).toEqual({
      identitySignals: ["clientId", "ip"],
    });
    expect(port.count("admin.device.list")).toBe(2);
  });
  it("saves the editor with a cleared binding and the chosen whitelist state", async () => {
    const port = fakePort(answer);
    const devices = new DevicesController(port as never);
    devices.edit(device(1, { label: "旧", boundUser: ulid(3) }) as never);
    devices.setLabel("新");
    devices.setBoundUser("");
    devices.setWhitelisted(true);
    devices.saveEditor();
    await settled();
    expect(port.last("admin.device.update")!.args).toEqual({
      id: ulid(1),
      label: "新",
      boundUser: null,
      whitelisted: true,
    });
    expect(devices.getState().editing).toBeUndefined();
  });
});

describe("announcements", () => {
  const answer = (method: string) =>
    method === "admin.announcement.list" ? page([]) : defaults(method);
  it("publishes only a complete draft after confirmation and reloads the history", async () => {
    const port = fakePort(answer);
    const announcements = new AnnouncementsController(port as never);
    announcements.attach();
    await settled();
    announcements.newDraft();
    announcements.setTitle("  ");
    announcements.setText("正文");
    expect(announcements.canPublish()).toBe(false);
    announcements.setTitle("标题");
    expect(announcements.canPublish()).toBe(true);
    announcements.askPublish();
    expect(port.count("admin.announcement.publish")).toBe(0);
    announcements.runConfirmed();
    await settled();
    expect(port.last("admin.announcement.publish")!.args).toEqual({
      title: "标题",
      text: "正文",
    });
    expect(announcements.getState().draft).toBeUndefined();
    expect(port.count("admin.announcement.list")).toBe(2);
  });
  it("keeps the draft and reports a failed publication", async () => {
    const port = fakePort((method) => {
      if (method === "admin.announcement.publish") throw new Error("内容过长");
      return method === "admin.announcement.list" ? page([]) : defaults(method);
    });
    const announcements = new AnnouncementsController(port as never);
    announcements.newDraft();
    announcements.setTitle("t");
    announcements.setText("x");
    announcements.runConfirmed();
    announcements.askPublish();
    announcements.runConfirmed();
    await settled();
    expect(announcements.getState().error).toBe("内容过长");
    expect(announcements.getState().draft).toEqual({ title: "t", text: "x" });
  });
});

describe("invitations", () => {
  it("lists failed revocations and clears the selection", async () => {
    const port = fakePort((method) =>
      method === "admin.invitation.bulkRevoke"
        ? {
            results: [
              { id: ulid(1), ok: true },
              { id: ulid(2), ok: false },
            ],
          }
        : page([]),
    );
    const invitations = new InvitationsController(port as never);
    invitations.setSelected(new Set([ulid(1), ulid(2)]));
    invitations.askBulkRevoke();
    invitations.runBulkRevoke();
    await settled();
    expect(invitations.getState().error).toBe(`撤销失败：${ulid(2)}`);
    expect(invitations.getState().selected.size).toBe(0);
  });
  it("labels invitations by claim and expiry", () => {
    const port = fakePort(() => page([]));
    const invitations = new InvitationsController(port as never);
    const base = {
      id: ulid(1),
      created: 1,
      expires: 2_000_000,
      claimedBy: null,
    };
    const rows = (items: object[]) => {
      (invitations as unknown as { state: unknown }).state = {
        ...invitations.getState(),
        list: { data: page(items), loading: false, error: "" },
      };
      return invitations.rows().map((r) => [r.status, r.canRevoke]);
    };
    expect(
      rows([base, { ...base, expires: 5 }, { ...base, claimedBy: ulid(2) }]),
    ).toEqual([
      ["待使用", true],
      ["已过期", true],
      ["已使用", false],
    ]);
  });
  it("reports a failed creation without a result", async () => {
    const port = fakePort(() => page([]));
    port.createInvitation.mockRejectedValue(new Error("x"));
    const invitations = new InvitationsController(port as never);
    await invitations.create();
    expect(invitations.getState()).toMatchObject({
      created: undefined,
      error: "无法创建邀请，请重试",
    });
  });
});

describe("system", () => {
  it("loads media policy for community managers and device policy otherwise, following role changes", async () => {
    const port = fakePort(() => settings, { roles: ["access_manager"] });
    const system = new SystemController(port as never);
    system.attach();
    await settled();
    expect(port.count("admin.device.policy.get")).toBe(1);
    port.setRoles(["community_manager"]);
    await settled();
    expect(port.count("admin.settings.get")).toBe(1);
    expect(system.getState().access).toMatchObject({
      media: true,
      policy: false,
    });
    system.toggle("whitelist");
    expect(system.getState().confirm?.label).toBe("启用设备白名单");
    system.detach();
  });
});

describe("incidents", () => {
  it("omits empty filters and converts the time range to epoch milliseconds", () => {
    expect(incidentQuery(emptyIncidentFilters(), 2)).toEqual({
      offset: 100,
      limit: 50,
    });
    const query = incidentQuery(
      {
        ...emptyIncidentFilters(),
        source: "client",
        module: "sync",
        from: "2026-01-02T03:04",
      },
      0,
    );
    expect(query).toMatchObject({
      source: "client",
      module: "sync",
      from: Date.parse("2026-01-02T03:04"),
    });
    expect(query).not.toHaveProperty("to");
  });
  it("raises a client fault locally and sends a server self-test to the server", async () => {
    const port = fakePort((method) =>
      method === "admin.incident.list" ? page([]) : OK,
    );
    const effects = { download: vi.fn(), raiseClientFault: vi.fn() };
    const incidents = new IncidentsController(port as never, effects);
    incidents.askSelfTest("client");
    incidents.runSelfTest();
    expect(effects.raiseClientFault).toHaveBeenCalledWith(
      "Client diagnostic self-test",
    );
    expect(port.count("admin.incident.selfTest")).toBe(0);
    incidents.askSelfTest("server");
    incidents.runSelfTest();
    await settled();
    expect(port.last("admin.incident.selfTest")!.args).toEqual({
      source: "server",
    });
  });
  it("hands the archive ticket to the download effect and reports a failure", async () => {
    let fail = false;
    const port = fakePort((method) => {
      if (method === "admin.incident.download") {
        if (fail) throw new Error("无权限");
        return { ticket: "t", url: "/d/1", expires: 1 };
      }
      return page([]);
    });
    const effects = { download: vi.fn(), raiseClientFault: vi.fn() };
    const incidents = new IncidentsController(port as never, effects);
    await incidents.download();
    expect(effects.download).toHaveBeenCalledWith("/d/1", "diagnostics.zip");
    fail = true;
    await incidents.download();
    expect(incidents.getState().error).toBe("无权限");
  });
});

describe("workbench", () => {
  it("shows a root every section and others only their roles' sections", () => {
    const ids = (roles: string[]) =>
      allowedSections(BUILT_IN_SECTIONS, roles).map((s) => s.id);
    expect(ids(["root"])).toHaveLength(BUILT_IN_SECTIONS.length);
    expect(ids(["access_manager"])).toEqual([
      "users",
      "invitations",
      "devices",
      "system",
    ]);
    expect(ids([])).toEqual([]);
  });
  it("falls back to the first allowed section and keeps debug reachable offline", () => {
    const allowed = allowedSections(BUILT_IN_SECTIONS, ["root"]);
    expect(currentSection(allowed, "nope")?.id).toBe("overview");
    expect(currentSection(allowed, "audit")?.id).toBe("audit");
    expect(workbenchContent(undefined, true)).toBe("forbidden");
    expect(workbenchContent(currentSection(allowed, "users"), false)).toBe(
      "offline",
    );
    expect(workbenchContent(currentSection(allowed, "debug"), false)).toBe(
      "section",
    );
    expect(workbenchContent(currentSection(allowed, "users"), true)).toBe(
      "section",
    );
  });
});
