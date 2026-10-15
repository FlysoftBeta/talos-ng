export interface Principal {
  id: string;
  type: "user" | "group";
  name: string;
}
export interface ShareGrant {
  id: string;
  principalType: "user" | "group";
  principal: string;
  level: "read" | "write" | "own";
  delegate: boolean;
}
export type GrantLevel = ShareGrant["level"];
export type GrantChange = Omit<ShareGrant, "id" | "level"> & {
  level: GrantLevel | null;
};
/** Commands of one shareable resource; the owning feature binds its own methods. */
export interface SharingAdapter {
  principals(): Promise<Principal[]>;
  list(): Promise<{ grants: ShareGrant[]; canShare: boolean }>;
  set(value: GrantChange): Promise<void>;
}
export interface GrantState {
  principals: Principal[];
  grants: ShareGrant[];
  canShare: boolean;
  /** Selected principal as "type:id", or empty. */
  selected: string;
  level: GrantLevel;
  delegate: boolean;
  error: string;
  loading: boolean;
  busy: boolean;
  revoke: ShareGrant | undefined;
}
export const levelLabels: Readonly<Record<GrantLevel, string>> = {
  read: "可查看",
  write: "可编辑",
  own: "可管理",
};
export const principalKey = (p: Pick<Principal, "id" | "type">): string =>
  `${p.type}:${p.id}`;
export const filterPrincipals = (
  principals: readonly Principal[],
  query: string,
): Principal[] => principals.filter((p) => p.name.includes(query));
export const principalOptionLabel = (p: Principal): string =>
  `${p.type === "group" ? "群组" : "用户"} · ${p.name}`;
export const grantHint = (grant: ShareGrant): string =>
  `${levelLabels[grant.level]}${grant.delegate ? " · 可转授" : ""}`;
export function principalName(
  principals: readonly Principal[],
  grant: Pick<ShareGrant, "principal" | "principalType">,
): string {
  return (
    principals.find(
      (p) => p.id === grant.principal && p.type === grant.principalType,
    )?.name ?? grant.principal
  );
}

/** Loads the grants of a resource and applies grant/revoke changes, refreshing after each. */
export class GrantController {
  private listeners = new Set<() => void>();
  private state: GrantState = {
    principals: [],
    grants: [],
    canShare: false,
    selected: "",
    level: "read",
    delegate: false,
    error: "",
    loading: true,
    busy: false,
    revoke: undefined,
  };
  constructor(private readonly adapter: SharingAdapter) {}
  getState = (): GrantState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private patch(value: Partial<GrantState>): void {
    this.state = { ...this.state, ...value };
    this.listeners.forEach((listener) => listener());
  }
  refresh = async (): Promise<void> => {
    try {
      const [principals, result] = await Promise.all([
        this.adapter.principals(),
        this.adapter.list(),
      ]);
      this.patch({
        principals,
        grants: result.grants,
        canShare: result.canShare,
        error: "",
      });
    } catch (e) {
      this.patch({
        error: e instanceof Error ? e.message : "分享信息加载失败",
      });
    } finally {
      this.patch({ loading: false });
    }
  };
  select = (selected: string): void => this.patch({ selected });
  setLevel = (level: GrantLevel): void => this.patch({ level });
  setDelegate = (delegate: boolean): void => this.patch({ delegate });
  askRevoke = (revoke: ShareGrant): void => this.patch({ revoke });
  cancelRevoke = (): void => this.patch({ revoke: undefined });
  /** Grants the selected principal the chosen level. */
  grant = async (): Promise<void> => {
    const { selected, principals, level, delegate } = this.state;
    const person = principals.find((p) => principalKey(p) === selected);
    if (person)
      await this.save({
        principalType: person.type,
        principal: person.id,
        level,
        delegate,
      });
  };
  confirmRevoke = async (): Promise<void> => {
    const { revoke } = this.state;
    if (revoke) await this.save({ ...revoke, level: null });
  };
  private async save(value: GrantChange): Promise<void> {
    this.patch({ busy: true });
    try {
      await this.adapter.set(value);
      this.patch({ selected: "", revoke: undefined });
      await this.refresh();
    } catch (e) {
      this.patch({ error: e instanceof Error ? e.message : "权限保存失败" });
    } finally {
      this.patch({ busy: false });
    }
  }
}
