import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { ConfirmDialog, Menu, Sheet } from "../../../ui/overlays/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { ListRow, StatePanel } from "../../../ui/feedback/index.ts";
import type { QueueRow } from "../model/queue.ts";
import "./media.css";

/** Rows of the context shown at most; the rest is "and N more". */
const UPCOMING_LIMIT = 100;
interface SectionActions {
  onPlay(index: number): void;
  onMove(index: number, delta: -1 | 1): void;
  onRemove(index: number): void;
}

function SectionRows({
  rows,
  ...actions
}: { rows: readonly QueueRow[] } & SectionActions): ReactElement {
  return (
    <>
      {rows.map((row, index) => (
        <ListRow
          key={`${index}:${row.id}`}
          title={row.title}
          leading={<span className="media-queue-index">{index + 1}</span>}
          onClick={() => actions.onPlay(index)}
          trailing={
            <Menu
              label={`更多操作 ${row.title}`}
              items={[
                {
                  label: "上移",
                  icon: "up",
                  hidden: !row.canUp,
                  onSelect: () => actions.onMove(index, -1),
                },
                {
                  label: "下移",
                  icon: "down",
                  hidden: !row.canDown,
                  onSelect: () => actions.onMove(index, 1),
                },
                {
                  label: "移出队列",
                  icon: "minus",
                  onSelect: () => actions.onRemove(index),
                },
              ]}
            />
          }
        />
      ))}
    </>
  );
}

/**
 * The play queue in two sections: the tracks the user queued ("队列中", played first and
 * removed once played) and the rest of the list playback started from ("接下来播放").
 */
export function QueueSheetView({
  nowPlaying,
  queue,
  contextTitle,
  upcoming,
  emptyState,
  onClear,
  onClose,
  queueActions,
  upcomingActions,
}: {
  nowPlaying: string | undefined;
  queue: readonly QueueRow[];
  contextTitle: string;
  upcoming: readonly QueueRow[];
  emptyState: "offline" | "empty" | "loading";
  onClear(): void;
  onClose(): void;
  queueActions: SectionActions;
  upcomingActions: SectionActions;
}): ReactElement {
  const [clearing, setClearing] = useState(false);
  const nothing = !queue.length && !upcoming.length;
  return (
    <Sheet
      open
      title="播放队列"
      subtitle={
        queue.length + upcoming.length
          ? `${queue.length + upcoming.length} 首`
          : undefined
      }
      onClose={onClose}
      actions={
        queue.length > 0 && (
          <Button
            size="small"
            variant="danger-ghost"
            onClick={() => setClearing(true)}
          >
            清空队列
          </Button>
        )
      }
    >
      <div className="media-queue" data-testid="media.queue">
        {nowPlaying !== undefined && (
          <>
            <div className="media-queue-heading">正在播放</div>
            <ListRow
              title={nowPlaying}
              selected
              className="media-queue-current"
              leading={
                <span className="media-queue-index">
                  <Icon name="volume" size={16} />
                </span>
              }
            />
          </>
        )}
        {queue.length > 0 && (
          <>
            <div className="media-queue-heading" data-testid="media.queue.user">
              队列中
            </div>
            <SectionRows rows={queue} {...queueActions} />
          </>
        )}
        {upcoming.length > 0 && (
          <>
            <div
              className="media-queue-heading"
              data-testid="media.queue.context"
            >
              {contextTitle ? `接下来播放 · ${contextTitle}` : "接下来播放"}
            </div>
            <SectionRows
              rows={upcoming.slice(0, UPCOMING_LIMIT)}
              {...upcomingActions}
            />
            {upcoming.length > UPCOMING_LIMIT && (
              <div className="media-queue-heading">
                还有 {upcoming.length - UPCOMING_LIMIT} 首
              </div>
            )}
          </>
        )}
        {nothing && (
          <StatePanel
            compact
            state={emptyState}
            title={emptyState === "loading" ? "正在同步播放队列" : "队列为空"}
            hint={
              emptyState === "empty" ? "在曲目菜单中选择加入队列" : undefined
            }
          />
        )}
      </div>
      <ConfirmDialog
        open={clearing}
        objectName="播放队列"
        destructive
        title="清空播放队列？"
        message="只清空「队列中」的曲目，正在播放的列表不受影响。"
        confirmLabel="清空"
        onClose={() => setClearing(false)}
        onConfirm={() => {
          setClearing(false);
          onClear();
        }}
      />
    </Sheet>
  );
}
