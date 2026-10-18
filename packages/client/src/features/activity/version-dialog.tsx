import type { ReactElement } from "react";
import type { StatusViewModel } from "../../core/status/model.ts";
import { Button } from "../../ui/actions/index.ts";
import { Dialog } from "../../ui/overlays/index.ts";
import { Progress } from "../../ui/feedback/index.ts";

/** The server refused this build; staying offline keeps the saved content usable. */
export function VersionRejectedDialog({
  open,
  update,
  updating,
  onUpdate,
  onStayOffline,
}: {
  open: boolean;
  update: StatusViewModel["update"];
  updating: boolean;
  onUpdate: () => void;
  onStayOffline: () => void;
}): ReactElement {
  const busy = updating && update.state !== "failed" && update.state !== "none";
  return (
    <Dialog
      open={open}
      size="sm"
      title="需要更新"
      onClose={onStayOffline}
      dismissible={!busy}
      data-testid="update.required"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onStayOffline}>
            保持离线
          </Button>
          <Button variant="primary" busy={busy} onClick={onUpdate}>
            现在更新
          </Button>
        </>
      }
    >
      <p className="confirm-text">
        服务器已更新，此版本无法再连接服务器。现在更新，或保持离线继续使用已保存的内容。
      </p>
      {update.state === "installing" && (
        <Progress label="更新进度" value={update.progress || 0} />
      )}
      {update.state === "failed" && update.message && (
        <p className="confirm-text">{update.message}</p>
      )}
    </Dialog>
  );
}
