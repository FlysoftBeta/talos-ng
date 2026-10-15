import { contract } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import type { ActionDef, ActionModel } from "./actions.ts";
import { dateTimeText, mebibytes } from "./format.ts";
import { OpsPanelController, initialPanelState } from "./panel.ts";
import type { OpsPanelState, PanelFrame } from "./panel.ts";
import { LONG_CALL_MS, opsCall, opsCapability } from "./port.ts";
import type { DownloadPort, OpsPort } from "./port.ts";
import { OpsQuery, emptyQuery } from "./query.ts";
import type { QueryState } from "./query.ts";

const ops = contract.ops;
export type BackupRecord = ResultOf<typeof ops.backup.list>[number];
export type OpsSettings = ResultOf<typeof ops.settings.get>;
export type BackupPort = OpsPort;

export interface BackupSettingsDraft {
  retention: number;
  daily: boolean;
}
export interface BackupState extends OpsPanelState {
  backups: QueryState<BackupRecord[]>;
  settings: QueryState<OpsSettings>;
  draft: BackupSettingsDraft | undefined;
}
export interface BackupRow {
  record: BackupRecord;
  title: string;
  hint: string;
  download: ActionModel;
  remove: ActionModel;
}
export interface BackupModel {
  frame: PanelFrame;
  create: ActionModel;
  rows: BackupRow[] | undefined;
  settings:
    | {
        draft: BackupSettingsDraft;
        editable: boolean;
        save: ActionModel;
      }
    | undefined;
}

/** Backup list, creation, download, deletion and the retention / daily-run settings. */
export class BackupController extends OpsPanelController<BackupState> {
  private draftBase = "";
  private readonly backups = this.track(
    new OpsQuery(this.port, ops.backup.list, {}, (backups) =>
      this.patch({ backups }),
    ),
  );
  private readonly settings = this.track(
    new OpsQuery(this.port, ops.settings.get, {}, (settings) => {
      const base = JSON.stringify(settings.data ?? null);
      // A changed server value replaces unsaved edits, as the form is rebuilt from it.
      if (settings.data && base !== this.draftBase) {
        this.draftBase = base;
        this.patch({
          settings,
          draft: {
            retention: settings.data.retention,
            daily: settings.data.daily,
          },
        });
      } else this.patch({ settings });
    }),
  );
  constructor(
    port: BackupPort,
    private readonly downloads: DownloadPort,
  ) {
    super(port, {
      ...initialPanelState,
      backups: emptyQuery(),
      settings: emptyQuery(),
      draft: undefined,
    });
  }
  setRetention = (retention: number): void => {
    if (this.state.draft)
      this.patch({ draft: { ...this.state.draft, retention } });
  };
  setDaily = (daily: boolean): void => {
    if (this.state.draft) this.patch({ draft: { ...this.state.draft, daily } });
  };

  protected defs(): ActionDef[] {
    const defs: ActionDef[] = [
      this.refreshDef(this.backups),
      {
        id: "create",
        label: "创建备份",
        method: ops.backup.create,
        run: async () => {
          await opsCall(
            this.port,
            ops.backup.create,
            {},
            { timeoutMs: LONG_CALL_MS },
          );
          this.backups.reload();
        },
      },
      {
        id: "save-settings",
        label: "保存备份设置",
        method: ops.settings.set,
        run: async () => {
          const { data } = this.state.settings,
            { draft } = this.state;
          if (!data || !draft) return;
          await opsCall(this.port, ops.settings.set, { ...data, ...draft });
          this.settings.reload();
        },
      },
    ];
    for (const row of this.state.backups.data ?? [])
      defs.push(
        {
          id: `download:${row.id}`,
          label: "下载",
          method: ops.backup.download,
          run: async () =>
            this.downloads.download(
              (await opsCall(this.port, ops.backup.download, { id: row.id }))
                .url,
            ),
        },
        {
          id: `delete:${row.id}`,
          label: "删除",
          method: ops.backup.delete,
          confirm: `删除备份 ${row.id}`,
          run: async () => {
            await opsCall(this.port, ops.backup.delete, { id: row.id });
            this.backups.reload();
          },
        },
      );
    return defs;
  }
  model(): BackupModel {
    const { backups, settings, draft } = this.state;
    return {
      frame: this.frame(
        "备份",
        "数据库与对象文件一起保存。恢复需停止服务器后由启动器执行。",
        this.backups,
        backups,
      ),
      create: this.action("create"),
      rows: backups.data?.map((record) => ({
        record,
        title: dateTimeText(record.created),
        hint: `${mebibytes(record.size)} · ${record.id}`,
        download: this.action(`download:${record.id}`),
        remove: this.action(`delete:${record.id}`),
      })),
      settings:
        settings.data && draft
          ? {
              draft,
              editable: opsCapability(this.port, ops.settings.set).ok,
              save: this.action("save-settings"),
            }
          : undefined,
    };
  }
}
