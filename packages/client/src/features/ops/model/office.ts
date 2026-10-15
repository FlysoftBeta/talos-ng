import { contract } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import type { ActionDef, ActionModel } from "./actions.ts";
import { kibibytes } from "./format.ts";
import { OpsPanelController, initialPanelState } from "./panel.ts";
import type { OpsPanelState, PanelFrame } from "./panel.ts";
import { opsCall } from "./port.ts";
import type { DownloadPort, OpsPort } from "./port.ts";
import { OpsQuery, emptyQuery } from "./query.ts";
import type { QueryState } from "./query.ts";

const ops = contract.ops;
export type OfficeList = ResultOf<typeof ops.office.list>;
export interface OfficeState extends OpsPanelState {
  list: QueryState<OfficeList>;
}
export interface OfficeRow {
  id: string;
  title: string;
  hint: string;
  download: ActionModel;
}
export interface OfficeModel {
  frame: PanelFrame;
  toolbar: ActionModel[];
  /** Set when there are no captured documents; undefined while loading or when rows exist. */
  empty: { title: string; hint: string } | undefined;
  rows: OfficeRow[];
}
const WINDOWS_ONLY = "仅支持 Windows";

/** Documents captured from Office / WPS on the Windows host. */
export class OfficeController extends OpsPanelController<OfficeState> {
  private readonly list = this.track(
    new OpsQuery(this.port, ops.office.list, {}, (list) =>
      this.patch({ list }),
    ),
  );
  constructor(
    port: OpsPort,
    private readonly downloads: DownloadPort,
  ) {
    super(port, { ...initialPanelState, list: emptyQuery() });
  }
  protected defs(): ActionDef[] {
    const { data } = this.state.list,
      disabled = data?.available ? undefined : WINDOWS_ONLY;
    const defs: ActionDef[] = [
      this.refreshDef(this.list),
      {
        id: "capture",
        label: "捕获当前文档",
        method: ops.office.refresh,
        disabled,
        run: async () => {
          await opsCall(this.port, ops.office.refresh, {});
          this.list.reload();
        },
      },
      {
        id: "clear",
        label: "清空捕获记录",
        method: ops.office.clear,
        disabled,
        confirm: "清空所有已捕获文档副本",
        run: async () => {
          await opsCall(this.port, ops.office.clear, {});
          this.list.reload();
        },
      },
    ];
    for (const file of data?.files ?? [])
      defs.push({
        id: `download:${file.id}`,
        label: "下载文档",
        method: ops.office.download,
        run: async () =>
          this.downloads.download(
            (await opsCall(this.port, ops.office.download, { id: file.id }))
              .url,
          ),
      });
    return defs;
  }
  model(): OfficeModel {
    const { list } = this.state,
      files = list.data?.files ?? [];
    return {
      frame: this.frame(
        "已打开的文档",
        "捕获 Windows 中已保存的 Word、PowerPoint、Excel 和 WPS 文档副本。未保存的更改不会被捕获。",
        this.list,
        list,
      ),
      toolbar: [this.action("capture"), this.action("clear")],
      empty:
        list.data && files.length === 0
          ? {
              title: list.data.available
                ? "尚无已捕获文档"
                : "此平台不支持文档捕获",
              hint: "Windows 上打开并保存 Office 或 WPS 文档后，可捕获副本。",
            }
          : undefined,
      rows: files.map((file) => ({
        id: file.id,
        title: file.name,
        hint: `${file.application} · ${kibibytes(file.size)}`,
        download: this.action(`download:${file.id}`),
      })),
    };
  }
}
