import { contract, rolesWithDependencies } from "@talos/contract";
import type { AdminRole, AdminUser, Feature } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type {
  RuntimeClockPort,
  RuntimeQueryPort,
} from "../../../core/runtime-port.ts";
import { holdsRole, roleNames } from "./access.ts";
import type { AdminActor } from "./access.ts";
import { bulkRequest, emptyBulkEdit, hasBulkChange } from "./bulk-users.ts";
import type { BulkEdit, BulkReportItem, Tri } from "./bulk-users.ts";
import { durationUntil } from "./duration.ts";
import {
  PAGE_SIZE,
  QueryResource,
  adminCall,
  failureText,
  sameValue,
} from "./query.ts";
import type { AdminCommandPort, LoadState } from "./query.ts";

export type UsersPort = AdminCommandPort &
  Pick<RuntimeQueryPort, "getSnapshot" | "subscribe"> &
  Pick<RuntimeClockPort, "time">;
export type UserSort = "handle" | "created" | "name";
export type UserPage = { items: AdminUser[]; total: number };
export type UserEditing = AdminUser | "new" | null;
type SingleChange = {
  banned?: boolean;
  bannedUntil?: number | null;
  mutedUntil?: number;
  deactivated?: boolean;
};

/** What the signed-in account may do in the users pane; the server remains the authority. */
export interface UsersAccess {
  selfId: string | undefined;
  list: Capability;
  create: Capability;
  update: Capability;
  bulk: Capability;
  /** Create button: command permission plus the access-manager responsibility. */
  canCreate: boolean;
  profile: boolean;
  credential: boolean;
  roles: boolean;
  features: boolean;
  restrict: boolean;
  deactivate: boolean;
  purge: boolean;
}
export function usersAccess(
  actor: AdminActor | undefined,
  can: (method: Parameters<AdminCommandPort["can"]>[0]) => Capability,
): UsersAccess {
  const create = can(contract.admin.user.create);
  return {
    selfId: actor?.id,
    list: can(contract.admin.user.list),
    create,
    update: can(contract.admin.user.update),
    bulk: can(contract.admin.user.bulk),
    canCreate: create.ok && holdsRole(actor, "access_manager"),
    profile: holdsRole(actor, "advanced_community_manager"),
    credential: holdsRole(actor, "community_manager"),
    roles: holdsRole(actor, "root"),
    features: holdsRole(actor, "feature_manager"),
    restrict: holdsRole(actor, "community_manager"),
    deactivate: holdsRole(actor, "advanced_community_manager"),
    purge: holdsRole(actor, "advanced_community_manager"),
  };
}

/** Row projection: labels and the row's available actions. */
export interface UserRow {
  user: AdminUser;
  roleLabel: string;
  status: string;
  muted: boolean;
  canEdit: boolean;
  canRestrict: boolean;
  canDeactivate: boolean;
  canPurge: boolean;
}
export function userRow(
  user: AdminUser,
  access: UsersAccess,
  now: number,
): UserRow {
  const muted = user.mutedUntil > now;
  return {
    user,
    roleLabel: user.roles.map((role) => roleNames[role]).join("、"),
    status: user.banned
      ? "封禁"
      : user.deactivated
        ? "停用"
        : muted
          ? "禁言"
          : "正常",
    muted,
    canEdit:
      access.update.ok &&
      (access.profile || access.credential || access.roles || access.features),
    canRestrict: access.update.ok && access.restrict,
    canDeactivate: access.update.ok && access.deactivate,
    canPurge: access.purge && user.id !== access.selfId,
  };
}

/** Role checkbox rule: adding a role adds what it depends on, removing one removes its dependants. */
export function toggledRoles(
  roles: readonly AdminRole[],
  role: AdminRole,
  checked: boolean,
): readonly AdminRole[] {
  return checked
    ? rolesWithDependencies([...roles, role])
    : roles.filter(
        (item) =>
          item !== role && !rolesWithDependencies([item]).includes(role),
      );
}

export interface UserDraft {
  handle: string;
  name: string;
  pin: string;
  roles: readonly AdminRole[];
  features: readonly Feature[];
}
/** The update request carries only fields that changed and that the account may manage. */
export function userUpdate(
  target: AdminUser,
  draft: UserDraft,
  access: UsersAccess,
): { id: string } & Record<string, unknown> {
  return {
    id: target.id,
    ...(access.profile &&
    (draft.handle !== target.handle || draft.name !== target.name)
      ? { handle: draft.handle, name: draft.name }
      : {}),
    ...(access.credential && draft.pin ? { pin: draft.pin } : {}),
    ...(access.roles && draft.roles.join() !== target.roles.join()
      ? { roles: [...rolesWithDependencies(draft.roles)] }
      : {}),
    ...(access.features && draft.features.join() !== target.features.join()
      ? { features: [...draft.features] }
      : {}),
  };
}
export function canSaveUser(
  editing: UserEditing,
  draft: Pick<UserDraft, "handle" | "pin">,
  busy: boolean,
): boolean {
  return !busy && !!draft.handle && !(editing === "new" && !draft.pin);
}

export interface UsersState {
  access: UsersAccess;
  list: LoadState<UserPage>;
  query: string;
  page: number;
  sort: UserSort;
  selected: ReadonlySet<string>;
  editing: UserEditing;
  handle: string;
  name: string;
  pin: string;
  discipline: Tri;
  roles: readonly AdminRole[];
  features: readonly Feature[];
  /** Pending confirmation; the confirmed command is kept inside the controller. */
  confirm: { label: string } | undefined;
  busy: boolean;
  error: string;
  report: readonly BulkReportItem[] | undefined;
  /** Restriction length in minutes shared by mute, ban and bulk restriction. */
  duration: number;
  banning: AdminUser | null;
  muting: AdminUser | null;
  bulkOpen: boolean;
  bulk: BulkEdit;
  creditUsers: string[] | undefined;
}

/** Users pane: server-paged list, editor, single restrictions, purge and tri-state bulk edits. */
export class UsersController extends StateStore<UsersState> {
  private cleanup: (() => void) | undefined;
  private pending: (() => Promise<void>) | undefined;
  private readonly list = new QueryResource<UserPage>((list) =>
    this.patch({ list }),
  );
  constructor(private readonly port: UsersPort) {
    super({
      access: usersAccess(port.getSnapshot().user, (m) => port.can(m)),
      list: { data: undefined, loading: true, error: "" },
      query: "",
      page: 0,
      sort: "handle",
      selected: new Set(),
      editing: null,
      handle: "",
      name: "",
      pin: "",
      discipline: "unchanged",
      roles: [],
      features: [],
      confirm: undefined,
      busy: false,
      error: "",
      report: undefined,
      duration: 1440,
      banning: null,
      muting: null,
      bulkOpen: false,
      bulk: emptyBulkEdit(),
      creditUsers: undefined,
    });
  }
  attach(): void {
    this.cleanup = this.port.subscribe(() => this.syncAccess());
    this.load();
  }
  detach(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    this.list.cancel();
  }
  rows(): UserRow[] {
    const now = this.port.time();
    return (this.state.list.data?.items ?? []).map((user) =>
      userRow(user, this.state.access, now),
    );
  }
  reload = (): void => this.list.reload();

  setQuery = (value: string): void => {
    this.patch({ query: value, page: 0 });
    this.load();
  };
  setPage = (page: number): void => {
    this.patch({ page });
    this.load();
  };
  /** Only the sortable server columns change the order. */
  sortBy = (column: string): void => {
    if (column === "handle" || column === "created" || column === "name") {
      this.patch({ sort: column, page: 0 });
      this.load();
    }
  };
  setSelected = (selected: ReadonlySet<string>): void =>
    this.patch({ selected });
  clearSelection = (): void => this.patch({ selected: new Set() });
  setDuration = (duration: number): void => this.patch({ duration });

  // Editor
  begin = (user: AdminUser | "new"): void =>
    this.patch({
      editing: user,
      error: "",
      handle: user === "new" ? "" : user.handle,
      name: user === "new" ? "" : user.name,
      pin: "",
      discipline: "unchanged",
      roles: user === "new" ? [] : user.roles,
      features: user === "new" ? [] : user.features,
    });
  cancelEdit = (): void => this.patch({ editing: null });
  setHandle = (handle: string): void => this.patch({ handle });
  setName = (name: string): void => this.patch({ name });
  setPin = (pin: string): void => this.patch({ pin });
  setDiscipline = (discipline: Tri): void => this.patch({ discipline });
  setRole = (role: AdminRole, checked: boolean): void =>
    this.patch({ roles: toggledRoles(this.state.roles, role, checked) });
  setFeature = (feature: Feature, checked: boolean): void =>
    this.patch({
      features: checked
        ? [...this.state.features, feature]
        : this.state.features.filter((item) => item !== feature),
    });
  canSave(): boolean {
    return canSaveUser(this.state.editing, this.state, this.state.busy);
  }
  save = async (): Promise<void> => {
    const { editing, access, handle, name, pin, features, discipline } =
      this.state;
    if (!editing) return;
    this.patch({ busy: true, error: "" });
    try {
      if (editing === "new")
        await this.port.command(contract.admin.user.create, {
          handle,
          name: name || handle,
          pin,
          ...(access.features ? { features: [...features] } : {}),
        });
      else {
        const changes = userUpdate(editing, this.state, access);
        if (Object.keys(changes).length > 1)
          await this.port.command(contract.admin.user.update, changes);
      }
      if (editing !== "new" && access.features && discipline !== "unchanged")
        await this.port.command(contract.learning.discipline.assign, {
          user: editing.id,
          enabled: discipline === "enable",
        });
      this.patch({ editing: null });
      this.reset();
    } catch (failure) {
      this.patch({ error: failureText(failure, "保存失败") });
    } finally {
      this.patch({ busy: false });
    }
  };

  // Single-user restrictions
  askBan = (user: AdminUser): void => {
    if (user.banned) this.single(user, { banned: false }, "解封");
    else this.patch({ banning: user });
  };
  askMute = (user: AdminUser): void => {
    if (user.mutedUntil > this.port.time())
      this.single(user, { mutedUntil: 0 }, "解除禁言");
    else this.patch({ muting: user });
  };
  deactivate = (user: AdminUser): void =>
    this.single(user, { deactivated: true }, "停用");
  purge = (user: AdminUser): void =>
    this.ask(`永久清除用户：${user.name}（${user.handle}）`, async () => {
      await this.port.command(contract.admin.user.purge, { id: user.id });
      this.reset();
    });
  closeRestriction = (): void => this.patch({ banning: null, muting: null });
  confirmBan = (): void => {
    const { banning, duration } = this.state;
    if (banning)
      this.single(
        banning,
        {
          banned: true,
          bannedUntil:
            duration === 0 ? null : durationUntil(duration, this.port.time()),
        },
        "封禁",
      );
    this.patch({ banning: null });
  };
  confirmMute = (): void => {
    const { muting, duration } = this.state;
    if (muting)
      this.single(
        muting,
        { mutedUntil: durationUntil(duration, this.port.time()) },
        "禁言",
      );
    this.patch({ muting: null });
  };

  // Bulk edit and reports
  openBulk = (): void => this.patch({ bulkOpen: true });
  closeBulk = (): void => this.patch({ bulkOpen: false });
  setGate = (feature: Feature, value: Tri): void =>
    this.patchBulk({ gates: { ...this.state.bulk.gates, [feature]: value } });
  setRoleChange = (role: AdminRole, value: Tri): void =>
    this.patchBulk({ roles: { ...this.state.bulk.roles, [role]: value } });
  setBulkMute = (mute: Tri): void => this.patchBulk({ mute });
  setBulkBan = (ban: Tri): void => this.patchBulk({ ban });
  canApplyBulk(): boolean {
    return hasBulkChange(this.state.bulk);
  }
  applyBulk = (): void => {
    const { selected, bulk, duration } = this.state;
    this.ask(`修改 ${selected.size} 位用户`, async () => {
      const result = await adminCall(
        this.port,
        contract.admin.user.bulk,
        bulkRequest([...selected], bulk, duration, this.port.time()),
      );
      this.patch({ report: result.results, bulkOpen: false });
      this.reset();
    });
  };
  closeReport = (): void => this.patch({ report: undefined });
  openCredit = (): void =>
    this.patch({ creditUsers: [...this.state.selected] });
  closeCredit = (): void => this.patch({ creditUsers: undefined });

  // Confirmation
  dismissConfirm = (): void => {
    this.pending = undefined;
    this.patch({ confirm: undefined });
  };
  runConfirmed = (): void => {
    const operation = this.pending;
    this.dismissConfirm();
    void operation?.().catch((failure: unknown) =>
      this.patch({ error: failureText(failure, "操作失败") }),
    );
  };

  private single(user: AdminUser, changes: SingleChange, label: string): void {
    this.ask(`${label}：${user.name}（${user.handle}）`, async () => {
      await this.port.command(contract.admin.user.update, {
        id: user.id,
        ...changes,
      });
      this.reset();
    });
  }
  private ask(label: string, run: () => Promise<void>): void {
    this.pending = run;
    this.patch({ confirm: { label } });
  }
  private patchBulk(change: Partial<BulkEdit>): void {
    this.patch({ bulk: { ...this.state.bulk, ...change } });
  }
  private reset(): void {
    this.list.reload();
    this.patch({ selected: new Set() });
  }
  private load(): void {
    this.list.run(() =>
      adminCall(this.port, contract.admin.user.list, {
        query: this.state.query,
        offset: this.state.page * PAGE_SIZE,
        limit: PAGE_SIZE,
        sort: this.state.sort,
      }),
    );
  }
  private syncAccess(): void {
    const access = usersAccess(this.port.getSnapshot().user, (m) =>
      this.port.can(m),
    );
    if (!sameValue(access, this.state.access)) this.patch({ access });
  }
}
