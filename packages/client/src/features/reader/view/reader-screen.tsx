import type { ReactElement } from "react";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import {
  ConfirmDialog,
  Dialog,
  Menu,
  Sheet,
} from "../../../ui/overlays/index.ts";
import { Group, KeyValue, Pane, PaneHeader } from "../../../ui/layout/index.ts";
import {
  InlineNotice,
  OfflineHint,
  StatePanel,
} from "../../../ui/feedback/index.ts";
import { Segmented } from "../../../ui/navigation/index.ts";
import type { DocumentResources } from "../model/resources.ts";
import type {
  ReaderDetails,
  ReaderPosition,
} from "../model/reading-session.ts";
import { ReaderViewer } from "./viewer.tsx";
import "./reader.css";

export function ReaderMissingView(): ReactElement {
  return <StatePanel state="forbidden" hint="文档已删除或访问权限已撤销" />;
}
/** Reading time in words: under a minute, minutes, or hours and minutes. */
export function readingTime(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "不到 1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}
export interface ReaderScreenViewProps {
  title: string;
  paged: boolean;
  processing: boolean;
  favourite: boolean;
  error: string;
  /** The error is caused by lack of connectivity rather than a failure. */
  errorOffline: boolean;
  resources: DocumentResources | undefined;
  initialPosition: ReaderPosition;
  zoom: string;
  onZoom: (zoom: string) => void;
  onBack: () => void;
  onToggleFavourite: () => void;
  onShowTasks: () => void;
  onRetry: () => void;
  onPosition: (position: ReaderPosition) => void;
  /** Details sheet. */
  details: ReaderDetails;
  detailsOpen: boolean;
  onShowDetails: () => void;
  onCloseDetails: () => void;
  deleteReason?: string;
  onAskDelete: () => void;
  deleting: boolean;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
  /** Offline retention dialog. */
  retentionOpen: boolean;
  onShowRetention: () => void;
  onCloseRetention: () => void;
  policy: string;
  onPolicy: (policy: string) => void;
  retentionStatus: string;
  retentionReason?: string;
  onSaveRetention: () => void;
}
const statusTone = (status: string): "confirmed" | "info" =>
  status.indexOf("已保留") === 0 ? "confirmed" : "info";
export function ReaderScreenView(props: ReaderScreenViewProps): ReactElement {
  const { details } = props;
  return (
    <Pane className="reader">
      <PaneHeader
        title={props.title}
        subtitle={[
          /^[0-9A-Z]{26}$/.test(details.author) ? "" : details.author,
          `${details.size} ${props.paged ? "页" : "字"}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        onBack={props.onBack}
        actions={
          <>
            <IconButton
              label={props.favourite ? "取消收藏" : "收藏"}
              icon="bookmark"
              pressed={props.favourite}
              onClick={props.onToggleFavourite}
            />
            <IconButton
              label="离线保留"
              icon="download"
              onClick={props.onShowRetention}
            />
            <Menu
              label="更多操作"
              items={[
                {
                  label: "详情",
                  icon: "info",
                  onSelect: props.onShowDetails,
                },
                {
                  label: "删除文档",
                  icon: "trash",
                  danger: true,
                  disabledReason: props.deleteReason,
                  onSelect: props.onAskDelete,
                },
              ]}
            />
          </>
        }
      />
      {props.processing ? (
        <StatePanel
          state="loading"
          title="文档正在转换"
          hint="转换进度和错误可在任务中查看"
          action={
            <Button variant="secondary" onClick={props.onShowTasks}>
              查看任务
            </Button>
          }
        />
      ) : props.error ? (
        <StatePanel
          state={props.errorOffline ? "offline" : "error"}
          hint={
            props.error === "离线未缓存" ? "连接服务器后即可打开" : props.error
          }
          action={
            <Button variant="secondary" onClick={props.onRetry}>
              重试
            </Button>
          }
        />
      ) : props.resources ? (
        <ReaderViewer
          resources={props.resources}
          initial={props.initialPosition}
          zoom={props.zoom}
          onZoom={props.onZoom}
          onPosition={props.onPosition}
          readingTime={readingTime(details.seconds)}
        />
      ) : (
        <StatePanel state="loading" />
      )}
      {props.detailsOpen && (
        <Sheet
          open
          title="文档详情"
          subtitle={details.title}
          onClose={props.onCloseDetails}
        >
          <Group>
            <KeyValue label="标题">{details.title}</KeyValue>
            <KeyValue label="作者">{details.author}</KeyValue>
            <KeyValue label="导入时间">{details.imported}</KeyValue>
            <KeyValue label={details.sizeLabel}>{details.size}</KeyValue>
          </Group>
          <Group title="阅读">
            <KeyValue label="最远阅读">{details.furthest}</KeyValue>
            <KeyValue label="阅读时长">{readingTime(details.seconds)}</KeyValue>
          </Group>
        </Sheet>
      )}
      {props.retentionOpen && (
        <Dialog
          open
          size="sm"
          title="离线保留"
          subtitle={props.title}
          onClose={props.onCloseRetention}
          footer={
            <>
              <Button variant="secondary" onClick={props.onCloseRetention}>
                取消
              </Button>
              <OfflineHint label="保存策略" reason={props.retentionReason}>
                <Button variant="primary" onClick={props.onSaveRetention}>
                  保存策略
                </Button>
              </OfflineHint>
            </>
          }
        >
          <div className="reader-retention">
            <span className="reader-retention-label">保留时长</span>
            <Segmented
              label="保留时长"
              block
              value={props.policy}
              options={[
                { value: "auto", label: "自动" },
                { value: "1", label: "1 天" },
                { value: "7", label: "7 天" },
                { value: "180", label: "180 天" },
              ]}
              onChange={props.onPolicy}
            />
            <p className="reader-muted">
              期限从保存时开始计算；自动模式不保证离线可用。
            </p>
            <InlineNotice tone={statusTone(props.retentionStatus)}>
              {props.retentionStatus}
            </InlineNotice>
          </div>
        </Dialog>
      )}
      {props.deleting && (
        <ConfirmDialog
          open
          destructive
          objectName={props.title}
          onClose={props.onCloseDelete}
          onConfirm={props.onConfirmDelete}
        />
      )}
    </Pane>
  );
}
