import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Dialog } from "../../../ui/overlays/index.ts";
import { SelectField } from "../../../ui/inputs/index.ts";
export function TrackRetentionView(p: {
  title: string;
  open: boolean;
  value: string;
  error: string;
  reason?: string;
  onOpen(): void;
  onClose(): void;
  onValue(value: string): void;
  onSave(): void;
}): ReactElement {
  return (
    <>
      {p.open && (
        <Dialog
          open
          title="我的离线保留"
          subtitle={p.title}
          onClose={p.onClose}
          footer={
            <Button disabledReason={p.reason} onClick={p.onSave}>
              保存设置
            </Button>
          }
        >
          <p>仅影响我的设备。自动不主动下载；歌单中的保留设置仍然有效。</p>
          <SelectField
            label="歌曲保留天数"
            value={p.value}
            onChange={(event) => p.onValue(event.target.value)}
          >
            {["auto", "1", "7", "30", "90", "180", "365"].map((value) => (
              <option key={value} value={value}>
                {value === "auto" ? "自动" : `${value} 天`}
              </option>
            ))}
          </SelectField>
          {p.error && <p role="alert">{p.error}</p>}
        </Dialog>
      )}
    </>
  );
}
