import type { ReactElement, ReactNode } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Dialog } from "../../../ui/overlays/index.ts";

export function PinReplacementView({
  step,
  prompt,
  busy,
  pinEntry,
  onClose,
  onAddSecond,
  onSingle,
}: {
  step: "pin" | "choice" | "done";
  prompt: string;
  busy: boolean;
  pinEntry: ReactNode;
  onClose: () => void;
  onAddSecond: () => void;
  onSingle: () => void;
}): ReactElement {
  return (
    <Dialog
      open
      size="sm"
      footer={
        step === "done" ? (
          <Button variant="primary" onClick={onClose}>
            完成
          </Button>
        ) : step === "choice" ? (
          <>
            <Button disabled={busy} onClick={onAddSecond}>
              添加第二个 PIN
            </Button>
            <Button busy={busy} variant="primary" onClick={onSingle}>
              只使用一个 PIN
            </Button>
          </>
        ) : (
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
        )
      }
      title="更换 PIN"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {step === "done" ? (
        <>
          <p role="status">PIN 已更换，旧 PIN 已全部失效。</p>
        </>
      ) : step === "choice" ? (
        <>
          <p>是否设置备用 PIN？两个 PIN 都能登录同一账号。</p>
        </>
      ) : (
        <>
          <div className="settings-pin">
            <p>{prompt}</p>
            {pinEntry}
          </div>
        </>
      )}
    </Dialog>
  );
}
