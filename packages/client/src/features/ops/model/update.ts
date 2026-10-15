import { contract } from "@talos/contract";
import type { ResultOf } from "@talos/contract";
import type { ActionDef, ActionModel } from "./actions.ts";
import type { OpsSettings } from "./backup.ts";
import { OpsPanelController, initialPanelState } from "./panel.ts";
import type { OpsPanelState, PanelFrame } from "./panel.ts";
import { LONG_CALL_MS, failureText, opsCall, opsCapability } from "./port.ts";
import type { OpsPort } from "./port.ts";
import { OpsQuery, emptyQuery } from "./query.ts";
import type { QueryState } from "./query.ts";

const ops = contract.ops;
export type UpdateStatus = ResultOf<typeof ops.update.status>;

/** Bytes of the chosen update package, read in slices (Chrome 70 FileReader, injected). */
export interface UploadSource {
  readonly size: number;
  slice(start: number, end: number): Promise<Uint8Array>;
}
export const UPLOAD_SLICE = 512 * 1024;

const phaseLabels: Record<UpdateStatus["phase"], string> = {
  idle: "待命",
  checking: "正在检查",
  staging: "正在准备",
  staged: "已准备",
  pending: "等待确认",
};

export interface UpdateState extends OpsPanelState {
  status: QueryState<UpdateStatus>;
  settings: QueryState<OpsSettings>;
  file: UploadSource | undefined;
  /** 0..1 */
  progress: number;
  /** Edited manifest URL; undefined shows the stored one. */
  manifestUrl: string | undefined;
}
export interface UpdateModel {
  frame: PanelFrame;
  tags: string[];
  lastError: string | undefined;
  uploadEnabled: boolean;
  /** Whole-percent upload progress, shown once it is above zero. */
  progressPercent: number | undefined;
  cloud:
    | {
        manifestUrl: string;
        editable: boolean;
        toggle: ActionModel;
        autoCheck: ActionModel;
        check: ActionModel;
        install: ActionModel;
      }
    | undefined;
  stage: ActionModel;
  apply: ActionModel;
  confirm: ActionModel;
}

/** Update staging, apply and confirm, plus the cloud update settings. */
export class UpdateController extends OpsPanelController<UpdateState> {
  private readonly status = this.track(
    new OpsQuery(this.port, ops.update.status, {}, (status) =>
      this.patch({ status }),
    ),
  );
  private readonly settings = this.track(
    new OpsQuery(this.port, ops.settings.get, {}, (settings) =>
      this.patch({ settings }),
    ),
  );
  constructor(port: OpsPort) {
    super(port, {
      ...initialPanelState,
      status: emptyQuery(),
      settings: emptyQuery(),
      file: undefined,
      progress: 0,
      manifestUrl: undefined,
    });
  }
  setFile = (file: UploadSource | undefined): void => this.patch({ file });
  setManifestUrl = (manifestUrl: string): void => this.patch({ manifestUrl });

  /**
   * Streams the package to the server in slices, commits it and stages it. A failure aborts
   * the upload so no partial object stays behind.
   */
  upload = async (): Promise<void> => {
    const file = this.state.file;
    if (!file) return;
    const begin = await opsCall(this.port, contract.upload.begin, {
      kind: "file",
      size: file.size,
    });
    try {
      for (let offset = begin.offset; offset < file.size;) {
        const bytes = await file.slice(offset, offset + UPLOAD_SLICE);
        const result = await opsCall(
          this.port,
          contract.upload.append,
          { id: begin.id, offset },
          { body: bytes },
        );
        offset = result.offset;
        this.patch({ progress: offset / file.size });
      }
      await opsCall(this.port, contract.upload.commit, { id: begin.id });
      await opsCall(
        this.port,
        ops.update.stage,
        { upload: begin.id },
        { timeoutMs: LONG_CALL_MS },
      );
      this.status.reload();
    } catch (error) {
      await opsCall(this.port, contract.upload.abort, { id: begin.id }).catch(
        () => undefined,
      );
      throw error instanceof Error
        ? error
        : new Error(failureText(error, "上传失败"));
    }
  };

  protected defs(): ActionDef[] {
    const data = this.state.status.data,
      stored = this.state.settings.data;
    const saveSettings = async (patch: Partial<OpsSettings>): Promise<void> => {
      if (!stored) return;
      await opsCall(this.port, ops.settings.set, { ...stored, ...patch });
      this.settings.reload();
    };
    return [
      this.refreshDef(this.status),
      {
        id: "stage",
        label: "上传并准备",
        method: ops.update.stage,
        disabled: !this.state.file
          ? "请先选择更新包"
          : !data?.launcher
            ? "请通过启动器运行"
            : undefined,
        run: this.upload,
      },
      {
        id: "apply",
        label: "应用并重启",
        method: ops.update.apply,
        disabled: data?.phase !== "staged" ? "请先准备更新" : undefined,
        confirm: `应用版本 ${data?.candidate ?? ""} 并重启服务器`,
        run: () => opsCall(this.port, ops.update.apply, {}),
      },
      {
        id: "confirm",
        label: "确认当前版本",
        method: ops.update.confirm,
        disabled: data?.phase !== "pending" ? "没有待确认的版本" : undefined,
        run: async () => {
          await opsCall(this.port, ops.update.confirm, {});
          this.status.reload();
        },
      },
      {
        id: "cloud-toggle",
        label: stored?.cloudEnabled
          ? "保存并关闭云端更新"
          : "保存并开启云端更新",
        method: ops.settings.set,
        run: () =>
          saveSettings({
            manifestUrl: this.state.manifestUrl ?? stored!.manifestUrl,
            cloudEnabled: !stored!.cloudEnabled,
          }),
      },
      {
        id: "auto-check",
        label: stored?.autoCheck ? "关闭自动检查" : "每 15 分钟自动检查",
        method: ops.settings.set,
        run: () => saveSettings({ autoCheck: !stored!.autoCheck }),
      },
      {
        id: "check",
        label: "检查云端版本",
        method: ops.update.check,
        run: async () => {
          await opsCall(this.port, ops.update.check, {});
          this.status.reload();
        },
      },
      {
        id: "install",
        label: "准备云端更新",
        method: ops.update.install,
        run: async () => {
          await opsCall(
            this.port,
            ops.update.install,
            {},
            { timeoutMs: LONG_CALL_MS },
          );
          this.status.reload();
        },
      },
    ];
  }
  model(): UpdateModel {
    const { status, settings, progress, manifestUrl } = this.state,
      data = status.data;
    return {
      frame: this.frame(
        "更新",
        "先验证并准备更新，再应用。请在重启后三分钟内确认；逾期自动恢复上一版本和备份。",
        this.status,
        status,
      ),
      tags: data
        ? [
            `当前 ${data.build}`,
            phaseLabels[data.phase],
            ...(data.candidate ? [`候选 ${data.candidate}`] : []),
          ]
        : [],
      lastError: data?.lastError ?? undefined,
      uploadEnabled: opsCapability(this.port, ops.update.stage).ok,
      progressPercent: progress > 0 ? Math.round(progress * 100) : undefined,
      stage: this.action("stage"),
      apply: this.action("apply"),
      confirm: this.action("confirm"),
      cloud: settings.data
        ? {
            manifestUrl: manifestUrl ?? settings.data.manifestUrl,
            editable: opsCapability(this.port, ops.settings.set).ok,
            toggle: this.action("cloud-toggle"),
            autoCheck: this.action("auto-check"),
            check: this.action("check"),
            install: this.action("install"),
          }
        : undefined,
    };
  }
}
