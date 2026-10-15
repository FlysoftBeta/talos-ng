import { contract } from "@talos/contract";
import type { CommunityConversation, CommunityMember } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { CommunityPort } from "./ports.ts";
import { message, onlineCall } from "./commands.ts";
export interface BrowserInput {
  open: boolean;
  parent?: CommunityConversation;
  onClose(): void;
}
export class GroupBrowserController extends StateStore<{
  query: string;
  groups: CommunityConversation[] | undefined;
  selected: CommunityConversation | undefined;
  password: string;
  error: string;
  busy: boolean;
}> {
  private generation = 0;
  constructor(
    private runtime: CommunityPort,
    private input: BrowserInput,
  ) {
    super({
      query: "",
      groups: undefined,
      selected: undefined,
      password: "",
      error: "",
      busy: false,
    });
  }
  update(input: BrowserInput): void {
    const changed =
      input.open !== this.input.open ||
      input.parent?.id !== this.input.parent?.id;
    this.input = input;
    this.patch({});
    if (changed) {
      ++this.generation;
      if (input.open && input.parent && this.can().ok) void this.search();
    }
  }
  start = (): (() => void) => {
    if (this.input.open && this.input.parent && this.can().ok)
      void this.search();
    return () => {
      ++this.generation;
    };
  };
  private can() {
    return this.runtime.can(
      this.input.parent
        ? contract.community.group.children
        : contract.community.group.find,
    );
  }
  setQuery = (query: string): void => this.patch({ query });
  setPassword = (password: string): void => this.patch({ password });
  select = (selected: CommunityConversation): void =>
    this.patch({ selected, password: "" });
  search = async (): Promise<void> => {
    const generation = ++this.generation;
    this.patch({ busy: true, error: "" });
    try {
      const groups = await (this.input.parent
        ? onlineCall(this.runtime, contract.community.group.children, {
            group: this.input.parent.id,
          })
        : onlineCall(this.runtime, contract.community.group.find, {
            query: this.state.query,
          }));
      if (generation === this.generation) this.patch({ groups });
    } catch (cause) {
      if (generation === this.generation) this.patch({ error: message(cause) });
    } finally {
      if (generation === this.generation) this.patch({ busy: false });
    }
  };
  join = async (): Promise<void> => {
    const { selected, password } = this.state,
      { parent, onClose } = this.input;
    if (!selected) return;
    this.patch({ busy: true, error: "" });
    try {
      const group = await onlineCall(
        this.runtime,
        contract.community.group.join,
        {
          group: selected.id,
          source: parent
            ? { type: "group", group: parent.id }
            : { type: "search" },
          ...(password ? { password } : {}),
        },
      );
      await this.runtime.sync();
      this.runtime.dispatch({ type: "openConversation", id: group.id });
      onClose();
    } catch (cause) {
      this.patch({ error: message(cause) });
    } finally {
      this.patch({ busy: false });
    }
  };
  presentation() {
    return {
      ...this.state,
      ...this.input,
      can: this.can(),
      setQuery: this.setQuery,
      setPassword: this.setPassword,
      select: this.select,
      search: this.search,
      join: this.join,
    };
  }
}
export interface CreateInput {
  open: boolean;
  groups: readonly CommunityConversation[];
  onClose(): void;
}
export class CreateGroupController extends StateStore<{
  name: string;
  handle: string;
  password: string;
  parent: string;
  discoverable: boolean;
  hidden: boolean;
  adminOnly: boolean;
  busy: boolean;
  error: string;
}> {
  constructor(
    private runtime: CommunityPort,
    private input: CreateInput,
  ) {
    super({
      name: "",
      handle: "",
      password: "",
      parent: "",
      discoverable: true,
      hidden: false,
      adminOnly: false,
      busy: false,
      error: "",
    });
  }
  update(input: CreateInput): void {
    this.input = input;
  }
  setName = (name: string): void => this.patch({ name });
  setHandle = (handle: string): void => this.patch({ handle });
  setPassword = (password: string): void => this.patch({ password });
  setParent = (parent: string): void => this.patch({ parent });
  setDiscoverable = (discoverable: boolean): void =>
    this.patch({ discoverable });
  setHidden = (hidden: boolean): void => this.patch({ hidden });
  setAdminOnly = (adminOnly: boolean): void => this.patch({ adminOnly });
  create = async (): Promise<void> => {
    this.patch({ busy: true, error: "" });
    const { name, handle, password, parent, discoverable, hidden, adminOnly } =
      this.state;
    try {
      const group = await onlineCall(
        this.runtime,
        contract.community.group.create,
        {
          name,
          ...(handle ? { handle } : {}),
          ...(password ? { password } : {}),
          parent: parent || null,
          discoverable,
          membersHidden: hidden,
          adminOnly,
        },
      );
      await this.runtime.sync();
      this.runtime.dispatch({ type: "openConversation", id: group.id });
      this.input.onClose();
    } catch (cause) {
      this.patch({ error: message(cause) });
    } finally {
      this.patch({ busy: false });
    }
  };
  presentation() {
    return {
      ...this.state,
      ...this.input,
      groups: this.input.groups.filter((g) => g.kind === "group"),
      can: this.runtime.can(contract.community.group.create),
      createDisabled: this.state.busy || !this.state.name.trim(),
      setName: this.setName,
      setHandle: this.setHandle,
      setPassword: this.setPassword,
      setParent: this.setParent,
      setDiscoverable: this.setDiscoverable,
      setHidden: this.setHidden,
      setAdminOnly: this.setAdminOnly,
      create: this.create,
    };
  }
}
export interface MembersInput {
  group: CommunityConversation;
  open: boolean;
  onClose(): void;
  cached: readonly CommunityMember[];
}
export class MembersController extends StateStore<{
  members: readonly CommunityMember[];
  hidden: boolean;
  selfHidden: boolean;
  error: string;
  leave: boolean;
}> {
  private generation = 0;
  private key = "";
  constructor(
    private runtime: CommunityPort,
    private input: MembersInput,
  ) {
    super({
      members: input.cached,
      hidden: false,
      selfHidden: false,
      error: "",
      leave: false,
    });
  }
  update(input: MembersInput): void {
    this.input = input;
    this.patch({});
    const key = `${input.open}:${input.group.id}:${this.runtime.can(contract.community.group.members).ok}`;
    if (key === this.key) return;
    this.key = key;
    const generation = ++this.generation;
    if (!input.open) return;
    this.patch({ members: input.cached });
    if (this.runtime.can(contract.community.group.members).ok)
      void onlineCall(this.runtime, contract.community.group.members, {
        group: input.group.id,
      })
        .then((result) => {
          if (generation === this.generation)
            this.patch({
              members: result.members,
              hidden: result.hidden,
              selfHidden: result.self.hidden,
            });
        })
        .catch((cause) => {
          if (generation === this.generation)
            this.patch({ error: message(cause) });
        });
  }
  dispose = (): void => {
    ++this.generation;
    this.key = "";
  };
  private async action(run: () => Promise<unknown>): Promise<void> {
    this.patch({ error: "" });
    try {
      await run();
    } catch (cause) {
      this.patch({ error: message(cause) });
    }
  }
  dm = (user: string): Promise<void> =>
    this.action(async () => {
      const dm = await onlineCall(this.runtime, contract.community.dm.open, {
        user,
        group: this.input.group.id,
      });
      await this.runtime.sync();
      this.runtime.dispatch({ type: "openConversation", id: dm.id });
      this.input.onClose();
    });
  hide = (hidden: boolean): Promise<void> =>
    this.action(async () => {
      await onlineCall(this.runtime, contract.community.group.hide, {
        group: this.input.group.id,
        hidden,
      });
      this.patch({ selfHidden: hidden });
    });
  leaveGroup = (): Promise<void> =>
    this.action(async () => {
      await onlineCall(this.runtime, contract.community.group.leave, {
        group: this.input.group.id,
      });
      this.patch({ leave: false });
      this.input.onClose();
      this.runtime.dispatch({ type: "back" });
    });
  setLeave = (leave: boolean): void => this.patch({ leave });
  presentation() {
    return {
      ...this.state,
      ...this.input,
      showHiddenNotice: this.state.hidden || this.input.group.membersHidden,
      canLeave: !this.input.group.noLeave,
      members: this.state.members.map((member) => ({
        ...member,
        self: member.user === this.runtime.getSnapshot().user?.id,
      })),
      can: this.runtime.can(contract.community.group.members),
      dm: this.dm,
      hide: this.hide,
      leaveGroup: this.leaveGroup,
      setLeave: this.setLeave,
    };
  }
}
