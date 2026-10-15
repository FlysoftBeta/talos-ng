import { contract } from "@talos/contract";
import type { AdminGroup, ResultOf } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type { RuntimeQueryPort } from "../../../core/runtime-port.ts";
import {
  PAGE_SIZE,
  QueryResource,
  adminCall,
  failureText,
  sameValue,
} from "./query.ts";
import type { AdminCommandPort, LoadState } from "./query.ts";

export type GroupsPort = AdminCommandPort & Pick<RuntimeQueryPort, "subscribe">;
export type GroupPage = ResultOf<typeof contract.admin.group.list>;
export type GroupMember = ResultOf<typeof contract.admin.group.members>[number];
export type CandidatePage = ResultOf<typeof contract.admin.user.list>;

export type GroupFlag =
  "discoverable" | "membersHidden" | "adminOnly" | "noLeave";
/** Flag checkboxes of the group editor in display order. */
export const GROUP_FLAGS: ReadonlyArray<readonly [GroupFlag, string]> = [
  ["discoverable", "可被发现"],
  ["membersHidden", "隐藏成员"],
  ["adminOnly", "仅管理员发言"],
  ["noLeave", "禁止退出"],
];

export interface GroupEditor {
  id?: string;
  name: string;
  handle: string;
  parent: string | null;
  password: string;
  clearPassword: boolean;
  discoverable: boolean;
  membersHidden: boolean;
  adminOnly: boolean;
  noLeave: boolean;
}
export const blankGroupEditor = (): GroupEditor => ({
  name: "",
  handle: "",
  parent: null,
  password: "",
  clearPassword: false,
  discoverable: false,
  membersHidden: false,
  adminOnly: false,
  noLeave: false,
});
export const groupEditorFrom = (group: AdminGroup): GroupEditor => ({
  id: group.id,
  name: group.name,
  handle: group.handle,
  parent: group.parent,
  password: "",
  clearPassword: false,
  discoverable: group.discoverable,
  membersHidden: group.membersHidden,
  adminOnly: group.adminOnly,
  noLeave: group.noLeave,
});
/** An existing group not found among the loaded rows is treated as reserved. */
export function editorKind(
  editor: Pick<GroupEditor, "id">,
  items: readonly AdminGroup[],
): "normal" | "system" {
  return !editor.id ||
    items.find((item) => item.id === editor.id)?.type === "normal"
    ? "normal"
    : "system";
}
/** Reserved system groups keep their parent; the password is cleared, replaced or left alone. */
export function groupInput(editor: GroupEditor, kind: "normal" | "system") {
  return {
    name: editor.name,
    handle: editor.handle || undefined,
    ...(kind === "normal" ? { parent: editor.parent } : {}),
    discoverable: editor.discoverable,
    membersHidden: editor.membersHidden,
    adminOnly: editor.adminOnly,
    noLeave: editor.noLeave,
    ...(editor.clearPassword
      ? { password: "" }
      : editor.password
        ? { password: editor.password }
        : {}),
  };
}
export const groupTypeLabel = (group: AdminGroup): string =>
  group.type === "normal" ? "普通" : "系统";

export interface MemberRow {
  member: GroupMember;
  role: string;
  visibility: string;
  /** Reserved groups and the owner cannot be removed. */
  canRemove: boolean;
  canMakeOwner: boolean;
}
export function memberRow(group: AdminGroup, member: GroupMember): MemberRow {
  const owner = group.owner === member.user;
  return {
    member,
    role: owner ? "群主" : "成员",
    visibility: member.hidden ? "已隐藏" : "公开",
    canRemove: !owner && group.type === "normal",
    canMakeOwner: !owner,
  };
}
/** Members are exactly addable by an exact, case-insensitive user name match. */
export function exactCandidate(
  candidates: CandidatePage | undefined,
  handle: string,
) {
  return candidates?.items.find(
    (item) =>
      item.handle.toLocaleLowerCase() === handle.trim().toLocaleLowerCase(),
  );
}

export interface GroupsAccess {
  list: Capability;
  edit: Capability;
  members: Capability;
}
export interface GroupsState {
  access: GroupsAccess;
  list: LoadState<GroupPage>;
  members: LoadState<GroupMember[]>;
  candidates: LoadState<CandidatePage>;
  parentOptions: LoadState<GroupPage>;
  query: string;
  page: number;
  editor: GroupEditor | undefined;
  parentQuery: string;
  /** Group whose member sheet is open. */
  memberGroup: AdminGroup | undefined;
  selectedMembers: ReadonlySet<string>;
  handle: string;
  confirm: { label: string } | undefined;
  error: string;
}

const emptyPage = { items: [], total: 0 };

/** Group administration: list, editor, parent lookup, membership and confirmed destructive commands. */
export class GroupsController extends StateStore<GroupsState> {
  private cleanup: (() => void) | undefined;
  private pending: (() => Promise<unknown>) | undefined;
  private readonly list = new QueryResource<GroupPage>((list) =>
    this.patch({ list }),
  );
  private readonly members = new QueryResource<GroupMember[]>((members) =>
    this.patch({ members }),
  );
  private readonly candidates = new QueryResource<CandidatePage>((candidates) =>
    this.patch({ candidates }),
  );
  private readonly parentOptions = new QueryResource<GroupPage>(
    (parentOptions) => this.patch({ parentOptions }),
  );
  constructor(private readonly port: GroupsPort) {
    super({
      access: groupsAccess(port),
      list: { data: undefined, loading: true, error: "" },
      members: { data: undefined, loading: false, error: "" },
      candidates: { data: emptyPage, loading: false, error: "" },
      parentOptions: { data: emptyPage, loading: false, error: "" },
      query: "",
      page: 0,
      editor: undefined,
      parentQuery: "",
      memberGroup: undefined,
      selectedMembers: new Set(),
      handle: "",
      confirm: undefined,
      error: "",
    });
  }
  attach(): void {
    this.cleanup = this.port.subscribe(() => {
      const access = groupsAccess(this.port);
      if (!sameValue(access, this.state.access)) this.patch({ access });
    });
    this.loadList();
  }
  detach(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    for (const resource of [
      this.list,
      this.members,
      this.candidates,
      this.parentOptions,
    ])
      resource.cancel();
  }
  reload = (): void => this.list.reload();
  /** Whether the open editor targets an ordinary or a reserved group. */
  editorKind(): "normal" | "system" {
    return editorKind(
      this.state.editor ?? {},
      this.state.list.data?.items ?? [],
    );
  }

  setQuery = (query: string): void => {
    this.patch({ query, page: 0 });
    this.loadList();
  };
  setPage = (page: number): void => {
    this.patch({ page });
    this.loadList();
  };

  // Editor
  create = (): void => this.openEditor(blankGroupEditor());
  edit = (group: AdminGroup): void => this.openEditor(groupEditorFrom(group));
  closeEditor = (): void => this.patch({ editor: undefined });
  setParentQuery = (parentQuery: string): void => {
    this.patch({ parentQuery });
    this.loadParents();
  };
  change = (change: Partial<GroupEditor>): void => {
    if (this.state.editor)
      this.patch({ editor: { ...this.state.editor, ...change } });
  };
  canSave(): boolean {
    return !!this.state.editor?.name.trim();
  }
  save = (): void => {
    const { editor } = this.state;
    if (!editor) return;
    const input = groupInput(editor, this.editorKind());
    void this.run(() =>
      editor.id
        ? adminCall(this.port, contract.admin.group.update, {
            id: editor.id,
            ...input,
          })
        : adminCall(this.port, contract.admin.group.create, input),
    );
  };

  // Members
  openMembers = (group: AdminGroup): void => {
    this.patch({ memberGroup: group, selectedMembers: new Set() });
    this.loadMembers();
    this.loadCandidates();
  };
  closeMembers = (): void => {
    this.patch({ memberGroup: undefined });
    this.loadMembers();
    this.loadCandidates();
  };
  setHandle = (handle: string): void => {
    this.patch({ handle });
    this.loadCandidates();
  };
  setSelectedMembers = (selectedMembers: ReadonlySet<string>): void =>
    this.patch({ selectedMembers });
  clearSelectedMembers = (): void => this.patch({ selectedMembers: new Set() });
  /** Rows of the open group's member table. */
  memberRows(): MemberRow[] {
    const group = this.state.memberGroup;
    return group
      ? (this.state.members.data ?? []).map((member) =>
          memberRow(group, member),
        )
      : [];
  }
  canAddMember(): boolean {
    return !!exactCandidate(this.state.candidates.data, this.state.handle);
  }
  addExact = (): void => {
    const group = this.state.memberGroup;
    const exact = exactCandidate(this.state.candidates.data, this.state.handle);
    if (exact && group)
      void this.run(() =>
        adminCall(this.port, contract.admin.group.member, {
          id: group.id,
          user: exact.id,
          operation: "add",
        }),
      );
  };
  askRemove = (group: AdminGroup, member: GroupMember): void =>
    this.memberOperation(
      `${group.name}的成员 ${member.name}`,
      group,
      member,
      "kick",
    );
  askOwner = (group: AdminGroup, member: GroupMember): void =>
    this.memberOperation(
      `${member.name}成为${group.name}群主`,
      group,
      member,
      "owner",
    );
  askRemoveSelected = (): void => {
    const group = this.state.memberGroup;
    if (!group || !this.state.selectedMembers.size) return;
    const ids = [...this.state.selectedMembers];
    this.ask(`${group.name}的 ${ids.length} 名成员`, async () => {
      const failures: string[] = [];
      for (const user of ids) {
        try {
          await adminCall(this.port, contract.admin.group.member, {
            id: group.id,
            user,
            operation: "kick",
          });
        } catch (failure) {
          failures.push(`${user}: ${failureText(failure, "操作失败")}`);
        }
      }
      this.patch({ selectedMembers: new Set() });
      if (failures.length) throw new Error(failures.join("；"));
    });
  };
  askDelete = (group: AdminGroup): void =>
    this.ask(group.name, () =>
      adminCall(this.port, contract.admin.group.delete, {
        id: group.id,
        name: group.name,
      }),
    );

  // Confirmation
  dismissConfirm = (): void => {
    this.pending = undefined;
    this.patch({ confirm: undefined });
  };
  runConfirmed = (): void => {
    const task = this.pending;
    this.dismissConfirm();
    if (task) void this.run(task);
  };

  private memberOperation(
    label: string,
    group: AdminGroup,
    member: GroupMember,
    operation: "kick" | "owner",
  ): void {
    this.ask(label, () =>
      adminCall(this.port, contract.admin.group.member, {
        id: group.id,
        user: member.user,
        operation,
      }),
    );
  }
  private ask(label: string, run: () => Promise<unknown>): void {
    this.pending = run;
    this.patch({ confirm: { label } });
  }
  private async run(task: () => Promise<unknown>): Promise<void> {
    try {
      await task();
      this.patch({ error: "", editor: undefined });
      this.list.reload();
      this.members.reload();
    } catch (failure) {
      this.patch({ error: failureText(failure, "操作失败") });
    }
  }
  private openEditor(editor: GroupEditor): void {
    this.patch({ parentQuery: "", editor });
    this.loadParents();
  }
  private loadList(): void {
    this.list.run(() =>
      adminCall(this.port, contract.admin.group.list, {
        query: this.state.query,
        offset: this.state.page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    );
  }
  private loadMembers(): void {
    const group = this.state.memberGroup;
    if (group)
      this.members.run(() =>
        adminCall(this.port, contract.admin.group.members, { id: group.id }),
      );
    else this.members.settle([]);
  }
  private loadCandidates(): void {
    const query = this.state.handle.trim();
    if (this.state.memberGroup && query)
      this.candidates.run(() =>
        adminCall(this.port, contract.admin.user.list, {
          query,
          offset: 0,
          limit: 20,
        }),
      );
    else this.candidates.settle(emptyPage);
  }
  private loadParents(): void {
    const query = this.state.parentQuery.trim();
    if (this.state.editor && query)
      this.parentOptions.run(() =>
        adminCall(this.port, contract.admin.group.list, {
          query,
          offset: 0,
          limit: 50,
        }),
      );
    else this.parentOptions.settle(emptyPage);
  }
}
function groupsAccess(port: AdminCommandPort): GroupsAccess {
  return {
    list: port.can(contract.admin.group.list),
    edit: port.can(contract.admin.group.create),
    members: port.can(contract.admin.group.member),
  };
}
