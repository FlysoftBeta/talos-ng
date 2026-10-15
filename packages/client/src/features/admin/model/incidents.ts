import { contract } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import { StateStore } from "../../../core/controller-state.ts";
import type { Capability } from "../../../core/lifecycle/snapshot.ts";
import type { RuntimeQueryPort } from "../../../core/runtime-port.ts";
import { localDate } from "./format.ts";
import {
  PAGE_SIZE,
  QueryResource,
  adminCall,
  failureText,
  sameValue,
} from "./query.ts";
import type { AdminCommandPort, LoadState } from "./query.ts";

export type IncidentsPort = AdminCommandPort &
  Pick<RuntimeQueryPort, "subscribe">;
/** Browser effects the incident pane needs: delivering the log archive and raising a client fault. */
export interface IncidentEffects {
  download(url: string, filename: string): void;
  raiseClientFault(message: string): void;
}
export type IncidentPage = ResultOf<typeof contract.admin.incident.list>;
export type IncidentDetail = ResultOf<typeof contract.admin.incident.detail>;
export type IncidentSource = "" | "client" | "server";
export type IncidentSelfTest = "server" | "client";

export interface IncidentFilters {
  level: string;
  source: IncidentSource;
  build: string;
  environment: string;
  module: string;
  query: string;
  from: string;
  to: string;
}
export const emptyIncidentFilters = (): IncidentFilters => ({
  level: "",
  source: "",
  build: "",
  environment: "",
  module: "",
  query: "",
  from: "",
  to: "",
});
export const SOURCE_OPTIONS: ReadonlyArray<readonly [IncidentSource, string]> =
  [
    ["", "全部来源"],
    ["client", "客户端"],
    ["server", "服务器"],
  ];
export const selfTestObject = (source: IncidentSelfTest): string =>
  `${source === "client" ? "客户端" : "服务器"}诊断自检事件`;

/** Query arguments: empty filters are omitted and datetime-local text becomes epoch milliseconds. */
export function incidentQuery(filters: IncidentFilters, page: number) {
  return {
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.build ? { build: filters.build } : {}),
    ...(filters.environment ? { environment: filters.environment } : {}),
    ...(filters.level ? { level: filters.level } : {}),
    ...(filters.module ? { module: filters.module } : {}),
    ...(filters.query ? { query: filters.query } : {}),
    ...(filters.from ? { from: Date.parse(filters.from) } : {}),
    ...(filters.to ? { to: Date.parse(filters.to) } : {}),
  };
}
export interface IncidentRow {
  id: string;
  summary: string;
  count: number;
  first: string;
  last: string;
}
export const incidentRow = (
  item: IncidentPage["items"][number],
): IncidentRow => ({
  id: item.id,
  summary: item.summary,
  count: item.count,
  first: localDate(item.first),
  last: localDate(item.last),
});
export const relatedIds = (detail: IncidentDetail): string =>
  detail.relatedIds.join("、") || "—";
export const stackText = (detail: IncidentDetail): string =>
  detail.stack || "无堆栈信息";

export interface IncidentsState {
  list: LoadState<IncidentPage>;
  detail: LoadState<IncidentDetail | undefined>;
  access: Capability;
  selfTestAccess: Capability;
  filters: IncidentFilters;
  page: number;
  detailId: string;
  confirm: IncidentSelfTest | undefined;
  error: string;
}

/** Diagnostics: filtered incident list, detail, self-tests and the log archive download. */
export class IncidentsController extends StateStore<IncidentsState> {
  private cleanup: (() => void) | undefined;
  private readonly list = new QueryResource<IncidentPage>((list) =>
    this.patch({ list }),
  );
  private readonly detail = new QueryResource<IncidentDetail | undefined>(
    (detail) => this.patch({ detail }),
  );
  constructor(
    private readonly port: IncidentsPort,
    private readonly effects: IncidentEffects,
  ) {
    super({
      list: { data: undefined, loading: true, error: "" },
      detail: { data: undefined, loading: false, error: "" },
      access: port.can(contract.admin.incident.list),
      selfTestAccess: port.can(contract.admin.incident.selfTest),
      filters: emptyIncidentFilters(),
      page: 0,
      detailId: "",
      confirm: undefined,
      error: "",
    });
  }
  attach(): void {
    this.cleanup = this.port.subscribe(() => {
      const access = this.port.can(contract.admin.incident.list);
      const selfTestAccess = this.port.can(contract.admin.incident.selfTest);
      if (
        !sameValue(
          [access, selfTestAccess],
          [this.state.access, this.state.selfTestAccess],
        )
      )
        this.patch({ access, selfTestAccess });
    });
    this.load();
  }
  detach(): void {
    this.cleanup?.();
    this.cleanup = undefined;
    this.list.cancel();
    this.detail.cancel();
  }
  rows(): IncidentRow[] {
    return (this.state.list.data?.items ?? []).map(incidentRow);
  }
  reload = (): void => this.list.reload();
  setPage = (page: number): void => {
    this.patch({ page });
    this.load();
  };
  /** Any filter change returns to the first page. */
  setFilter = <K extends keyof IncidentFilters>(
    name: K,
    value: IncidentFilters[K],
  ): void => {
    this.patch({ filters: { ...this.state.filters, [name]: value }, page: 0 });
    this.load();
  };
  openDetail = (id: string): void => {
    this.patch({ detailId: id });
    this.loadDetail();
  };
  closeDetail = (): void => this.openDetail("");
  download = async (): Promise<void> => {
    try {
      const ticket = await adminCall(
        this.port,
        contract.admin.incident.download,
        {},
      );
      this.effects.download(ticket.url, "diagnostics.zip");
    } catch (failure) {
      this.patch({ error: failureText(failure, "下载失败") });
    }
  };
  askSelfTest = (source: IncidentSelfTest): void =>
    this.patch({ confirm: source });
  dismissConfirm = (): void => this.patch({ confirm: undefined });
  runSelfTest = (): void => {
    const source = this.state.confirm;
    this.patch({ confirm: undefined });
    if (source === "client") {
      this.effects.raiseClientFault("Client diagnostic self-test");
      return;
    }
    if (source)
      void adminCall(this.port, contract.admin.incident.selfTest, { source })
        .catch((failure: unknown) =>
          this.patch({ error: failureText(failure, "自检失败") }),
        )
        .then(this.list.reload);
  };

  private load(): void {
    this.list.run(() =>
      adminCall(
        this.port,
        contract.admin.incident.list,
        incidentQuery(this.state.filters, this.state.page),
      ),
    );
  }
  private loadDetail(): void {
    const id = this.state.detailId;
    if (id)
      this.detail.run(() =>
        adminCall(this.port, contract.admin.incident.detail, { id }),
      );
    else this.detail.settle(undefined);
  }
}
