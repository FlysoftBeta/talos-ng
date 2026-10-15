import type { ReactElement, ReactNode } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Dialog } from "../../../ui/overlays/index.ts";
import "./learning.css";
export function ExitDialogView({
  open,
  summary,
  saving,
  onCancel,
  onFinish,
}: {
  open: boolean;
  summary: ReactNode;
  saving: boolean;
  onCancel: () => void;
  onFinish: () => void;
}): ReactElement {
  return (
    <Dialog
      open={open}
      size="sm"
      title="本次练习总结"
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            继续练习
          </Button>
          <Button variant="primary" disabled={saving} onClick={onFinish}>
            结束并离开
          </Button>
        </>
      }
    >
      {summary}
    </Dialog>
  );
}
export function PauseDialogView({
  open,
  onResume,
}: {
  open: boolean;
  onResume: () => void;
}): ReactElement {
  return (
    <Dialog
      open={open}
      size="sm"
      title="练习已暂停"
      onClose={onResume}
      footer={
        <Button variant="primary" onClick={onResume}>
          继续练习
        </Button>
      }
    >
      <p className="learn-dialog-text">
        刚才离开了页面。计时已暂停，准备好后继续。
      </p>
    </Dialog>
  );
}
export function DisciplineDialogView({
  open,
  dismissible,
  onClose,
  onEscape,
  onReturn,
  children,
}: {
  open: boolean;
  dismissible: boolean;
  onClose: () => void;
  onEscape: () => void;
  onReturn: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Dialog
      open={open}
      size="md"
      title="自律时刻 · 练习一题"
      onClose={onClose}
      dismissible={dismissible}
      onEscape={onEscape}
      footer={
        dismissible ? (
          <Button variant="primary" onClick={onReturn}>
            返回应用
          </Button>
        ) : undefined
      }
    >
      {children}
    </Dialog>
  );
}
