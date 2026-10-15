import { contract } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type { RuntimeQueryPort } from "../../../core/runtime-port.ts";
import { shanghaiDate } from "./format.ts";
import { QueryResource, adminCall, sameValue } from "./query.ts";
import type { AdminCommandPort, LoadState } from "./query.ts";

export type AuditPort = AdminCommandPort & Pick<RuntimeQueryPort, "subscribe">;
export type AuditPage = ResultOf<typeof contract.admin.audit.list>;
export type AuditEntry = AuditPage["items"][number];
export const AUDIT_PAGE_SIZE = 100;

export interface AuditRow {
  entry: AuditEntry;
  time: string;
  actor: string;
  target: string;
}
export const auditRow = (entry: AuditEntry): AuditRow => ({
  entry,
  time: shanghaiDate(entry.created),
  actor: entry.actor || "系统",
  target: entry.target || "—",
});

export interface AuditState {
  list: LoadState<AuditPage>;
  access: Capability;
  page: number;
}

/** Read-only, server-paged audit log. */
export class AuditController extends StateStore<AuditState> {
  private cleanup: (() => void) | undefined;
  private readonly list = new QueryResource<AuditPage>((list) =>
    this.patch({ list }),
  );
  constructor(private readonly port: AuditPort) {
    super({
      list: { data: undefined, loading: true, error: "" },
      access: port.can(contract.admin.audit.list),
      page: 0,
    });
  }
  attach(): void {
    this.cleanup = this.port.subscribe(() => {
      const access = this.port.can(contract.admin.audit.list);
      if (!sameValue(access, this.state.access)) this.patch({ access });
    });
    this.load();
  }
  detach(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    this.list.cancel();
  }
  rows(): AuditRow[] {
    return (this.state.list.data?.items ?? []).map(auditRow);
  }
  reload = (): void => this.list.reload();
  setPage = (page: number): void => {
    this.patch({ page });
    this.load();
  };
  private load(): void {
    this.list.run(() =>
      adminCall(this.port, contract.admin.audit.list, {
        offset: this.state.page * AUDIT_PAGE_SIZE,
        limit: AUDIT_PAGE_SIZE,
      }),
    );
  }
}
