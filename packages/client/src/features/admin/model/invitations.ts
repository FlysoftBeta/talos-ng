import { contract } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type {
  RuntimeClockPort,
  RuntimeQueryPort,
  RuntimeSessionPort,
} from "../../../core/runtime-port.ts";
import { shanghaiDate } from "./format.ts";
import {
  PAGE_SIZE,
  QueryResource,
  adminCall,
  failureText,
  sameValue,
} from "./query.ts";
import type { AdminCommandPort, LoadState } from "./query.ts";

export type InvitationsPort = AdminCommandPort &
  Pick<RuntimeQueryPort, "subscribe"> &
  Pick<RuntimeClockPort, "time"> &
  Pick<RuntimeSessionPort, "createInvitation">;
export type InvitationPage = ResultOf<typeof contract.admin.invitation.list>;
export type Invitation = InvitationPage["items"][number];

export interface InvitationRow {
  invitation: Invitation;
  created: string;
  expires: string;
  status: string;
  canRevoke: boolean;
}
export function invitationRow(
  invitation: Invitation,
  now: number,
): InvitationRow {
  return {
    invitation,
    created: shanghaiDate(invitation.created),
    expires: shanghaiDate(invitation.expires),
    status: invitation.claimedBy
      ? "已使用"
      : invitation.expires < now
        ? "已过期"
        : "待使用",
    canRevoke: !invitation.claimedBy,
  };
}
export interface CreatedInvitation {
  id: string;
  pin: string;
  expires: number;
}
export const invitationExpiry = (created: CreatedInvitation): string =>
  shanghaiDate(created.expires);

export interface InvitationsState {
  list: LoadState<InvitationPage>;
  access: Capability;
  createAccess: Capability;
  page: number;
  created: CreatedInvitation | undefined;
  error: string;
  revoke: { id: string } | undefined;
  selected: ReadonlySet<string>;
  bulkConfirm: boolean;
}

/** One-time invitations: creation, paging and single or bulk revocation. */
export class InvitationsController extends StateStore<InvitationsState> {
  private cleanup: (() => void) | undefined;
  private readonly list = new QueryResource<InvitationPage>((list) =>
    this.patch({ list }),
  );
  constructor(private readonly port: InvitationsPort) {
    super({
      list: { data: undefined, loading: true, error: "" },
      access: port.can(contract.admin.invitation.list),
      createAccess: port.can(contract.identity.invitation.create),
      page: 0,
      created: undefined,
      error: "",
      revoke: undefined,
      selected: new Set(),
      bulkConfirm: false,
    });
  }
  attach(): void {
    this.cleanup = this.port.subscribe(() => {
      const access = this.port.can(contract.admin.invitation.list);
      const createAccess = this.port.can(contract.identity.invitation.create);
      if (
        !sameValue(
          [access, createAccess],
          [this.state.access, this.state.createAccess],
        )
      )
        this.patch({ access, createAccess });
    });
    this.load();
  }
  detach(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    this.list.cancel();
  }
  rows(): InvitationRow[] {
    const now = this.port.time();
    return (this.state.list.data?.items ?? []).map((item) =>
      invitationRow(item, now),
    );
  }
  reload = (): void => this.list.reload();
  setPage = (page: number): void => {
    this.patch({ page });
    this.load();
  };
  setSelected = (selected: ReadonlySet<string>): void =>
    this.patch({ selected });
  clearSelection = (): void => this.patch({ selected: new Set() });
  create = async (): Promise<void> => {
    try {
      this.patch({ created: await this.port.createInvitation() });
      this.list.reload();
    } catch {
      this.patch({ error: "无法创建邀请，请重试" });
    }
  };
  askRevoke = (invitation: Invitation): void =>
    this.patch({ revoke: { id: invitation.id } });
  dismissRevoke = (): void => this.patch({ revoke: undefined });
  runRevoke = (): void => {
    const id = this.state.revoke?.id;
    this.patch({ revoke: undefined });
    if (id)
      void adminCall(this.port, contract.admin.invitation.revoke, { id })
        .then(this.list.reload)
        .catch((failure: unknown) => this.fail(failure));
  };
  askBulkRevoke = (): void => this.patch({ bulkConfirm: true });
  dismissBulkRevoke = (): void => this.patch({ bulkConfirm: false });
  runBulkRevoke = (): void => {
    const ids = [...this.state.selected];
    this.patch({ bulkConfirm: false });
    void adminCall(this.port, contract.admin.invitation.bulkRevoke, { ids })
      .then((report) => {
        this.patch({ selected: new Set() });
        this.list.reload();
        const failed = report.results.filter((row) => !row.ok);
        if (failed.length)
          this.patch({
            error: `撤销失败：${failed.map((row) => row.id).join("、")}`,
          });
      })
      .catch((failure: unknown) => this.fail(failure));
  };

  private fail(failure: unknown): void {
    this.patch({ error: failureText(failure, "操作失败，请重试") });
  }
  private load(): void {
    this.list.run(() =>
      adminCall(this.port, contract.admin.invitation.list, {
        offset: this.state.page * PAGE_SIZE,
        limit: PAGE_SIZE,
      }),
    );
  }
}
