import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { ConfirmDialog, Menu, Sheet } from "../../../ui/overlays/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { ListRow, StatePanel } from "../../../ui/feedback/index.ts";
import type { QueueRow } from "../model/queue.ts";
import "./media.css";

export function QueueSheetView({
  rows,
  emptyState,
  onPlay,
  onMove,
  onRemove,
  onClear,
  onClose,
}: {
  rows: readonly QueueRow[];
  emptyState: "offline" | "empty";
  onPlay(id: string): void;
  onMove(index: number, delta: -1 | 1): void;
  onRemove(index: number): void;
  onClear(): void;
  onClose(): void;
}): ReactElement {
  const [clearing, setClearing] = useState(false);
  return (
    <Sheet
      open
      title="播放队列"
      subtitle={rows.length ? `${rows.length} 首` : undefined}
      onClose={onClose}
      actions={
        rows.length > 0 && (
          <Button
            size="small"
            variant="danger-ghost"
            onClick={() => setClearing(true)}
          >
            清空
          </Button>
        )
      }
    >
      <div className="media-queue" data-testid="media.queue">
        {rows.length ? (
          rows.map((row, index) => (
            <ListRow
              key={`${index}:${row.id}`}
              title={row.title}
              selected={row.current}
              className={row.current ? "media-queue-current" : ""}
              leading={
                <span className="media-queue-index">
                  {row.current ? <Icon name="volume" size={16} /> : index + 1}
                </span>
              }
              onClick={() => onPlay(row.id)}
              trailing={
                <Menu
                  label={`更多操作 ${row.title}`}
                  items={[
                    {
                      label: "上移",
                      icon: "up",
                      hidden: !row.canUp,
                      onSelect: () => onMove(index, -1),
                    },
                    {
                      label: "下移",
                      icon: "down",
                      hidden: !row.canDown,
                      onSelect: () => onMove(index, 1),
                    },
                    {
                      label: "移出队列",
                      icon: "minus",
                      onSelect: () => onRemove(index),
                    },
                  ]}
                />
              }
            />
          ))
        ) : (
          <StatePanel
            compact
            state={emptyState}
            title="队列为空"
            hint={
              emptyState === "offline" ? undefined : "在曲目菜单中选择加入队列"
            }
          />
        )}
      </div>
      <ConfirmDialog
        open={clearing}
        objectName="播放队列"
        destructive
        title="清空播放队列？"
        message="队列中的曲目会被移出，曲目本身不受影响。"
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
