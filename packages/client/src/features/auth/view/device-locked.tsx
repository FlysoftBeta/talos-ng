import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Dialog } from "../../../ui/overlays/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import { InlineNotice } from "../../../ui/feedback/index.ts";
import "./auth.css";
import { ClientBadge } from "./client-badge.tsx";
export function DeviceLockedView({
  title,
  hint,
  countdown,
  retryDisabled,
  device,
  logout,
  onRetry,
}: {
  title: string;
  hint: string;
  /** Countdown text; undefined hides the line. */
  countdown?: string;
  retryDisabled: boolean;
  device?: string;
  logout?: {
    name: string;
    /** Why logging out is unavailable. */
    reason?: string;
    confirming: boolean;
    busy: boolean;
    error?: string;
    onAsk: () => void;
    onCancel: () => void;
    onConfirm: () => void;
  };
  onRetry?: () => void;
}): ReactElement {
  return (
    <main className="auth-page" data-testid="auth.device-locked">
      <header className="auth-top">
        <span className="auth-brand">Talos II</span>
      </header>
      <section className="auth-card">
        <div className="auth-symbol is-warning">
          <Icon name="lock" size={24} />
        </div>
        <h1>{title}</h1>
        <p className="auth-intro">{hint}</p>
        {countdown !== undefined && (
          <p className="auth-timer num" role="timer" aria-live="polite">
            {countdown}
          </p>
        )}
        <div className="auth-actions">
          {onRetry && (
            <Button
              variant="primary"
              block
              disabled={retryDisabled}
              onClick={onRetry}
            >
              重新尝试
            </Button>
          )}
          {logout && (
            <Button
              variant="ghost"
              block
              disabledReason={logout.reason}
              onClick={logout.onAsk}
            >
              退出登录
            </Button>
          )}
          {logout?.reason && (
            <p className="auth-message" role="status">
              {logout.reason}
            </p>
          )}
        </div>
      </section>
      <footer className="auth-bottom">
        <ClientBadge device={device} />
      </footer>
      {logout && (
        <Dialog
          open={logout.confirming}
          title={`退出「${logout.name}」？`}
          size="sm"
          onClose={logout.onCancel}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={logout.busy}
                onClick={logout.onCancel}
              >
                取消
              </Button>
              <Button
                variant="danger"
                disabled={logout.busy || !!logout.reason}
                onClick={logout.onConfirm}
              >
                确认退出登录
              </Button>
            </>
          }
        >
          <p className="confirm-text">
            将撤销此设备上的服务器会话。本机缓存保留，离线解锁凭据已移除。
          </p>
          {logout.error && (
            <InlineNotice tone="failed">{logout.error}</InlineNotice>
          )}
        </Dialog>
      )}
    </main>
  );
}
