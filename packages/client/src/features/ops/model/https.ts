import { contract } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import type { ActionDef } from "./actions.ts";
import { dateText } from "./format.ts";
import { OpsPanelController, initialPanelState } from "./panel.ts";
import type { OpsPanelState, PanelFrame } from "./panel.ts";
import type { OpsPort } from "./port.ts";
import { OpsQuery, emptyQuery } from "./query.ts";
import type { QueryState } from "./query.ts";

const ops = contract.ops;
export type HttpsStatus = ResultOf<typeof ops.https.status>;
export interface HttpsState extends OpsPanelState {
  status: QueryState<HttpsStatus>;
}
export interface HttpsModel {
  frame: PanelFrame;
  details:
    | {
        domain: string;
        expiry: string;
        redirect: string;
        listeners: { title: string; hint: string; tag: string }[];
        /** The root certificate is downloadable. */
        ca: boolean;
      }
    | undefined;
}

export function httpsDetails(
  status: HttpsStatus,
): NonNullable<HttpsModel["details"]> {
  return {
    domain: status.domain || "未配置",
    expiry: status.expiry ? dateText(status.expiry) : "未启用 HTTPS",
    redirect: status.redirect ? "已启用 · 308，不缓存" : "未启用",
    listeners: status.listeners.map((row) => ({
      title: `${row.secure ? "HTTPS" : "HTTP"} · ${row.port}`,
      hint: row.host,
      tag: row.secure ? "加密" : "未加密",
    })),
    ca: status.ca,
  };
}

/** Read-only TLS status; certificates stay in the server configuration file. */
export class HttpsController extends OpsPanelController<HttpsState> {
  private readonly status = this.track(
    new OpsQuery(this.port, ops.https.status, {}, (status) =>
      this.patch({ status }),
    ),
  );
  constructor(port: OpsPort) {
    super(port, { ...initialPanelState, status: emptyQuery() });
  }
  protected defs(): ActionDef[] {
    return [this.refreshDef(this.status)];
  }
  model(): HttpsModel {
    const { status } = this.state;
    return {
      frame: this.frame(
        "HTTPS",
        "在服务器配置文件中设置证书与域名。证书文件变更后自动重载。",
        this.status,
        status,
      ),
      details: status.data ? httpsDetails(status.data) : undefined,
    };
  }
}
