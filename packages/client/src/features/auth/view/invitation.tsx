import type { ReactElement, ReactNode } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Stack } from "../../../ui/layout/index.ts";
import { InlineNotice, OfflineHint } from "../../../ui/feedback/index.ts";
import "./auth.css";
import { Sheet } from "../../../ui/overlays/index.ts";
export function InvitationSheetView({
  open,
  busy,
  error,
  denied,
  pin,
  expires,
  onClose,
  onCreate,
  children,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  /** Why creation is unavailable. */
  denied?: string;
  pin?: string;
  expires?: string;
  onClose: () => void;
  onCreate: () => void;
  children?: ReactNode;
}): ReactElement {
  return (
    <Sheet open={open} title="管理 · 邀请成员" onClose={onClose}>
      {children}
      <Stack>
        <p className="muted">
          创建一次性邀请码。新成员在登录页输入后，可设置自己的 PIN 和个人资料。
        </p>
        <OfflineHint label="创建邀请" reason={denied}>
          <Button
            variant="primary"
            busy={busy}
            disabled={denied !== undefined}
            onClick={onCreate}
          >
            创建邀请
          </Button>
        </OfflineHint>
        {error && (
          <InlineNotice
            tone="failed"
            action={
              <Button size="small" onClick={onCreate}>
                重试
              </Button>
            }
          >
            {error}
          </InlineNotice>
        )}
        {pin !== undefined && (
          <div className="auth-invite" data-testid="auth.invitation.result">
            <span className="auth-invite-label">一次性邀请码</span>
            <strong
              className="auth-invite-pin selectable num"
              data-testid="auth.invitation.pin"
            >
              {pin}
            </strong>
            <span className="auth-invite-meta">有效期至 {expires}</span>
            <p className="muted t-2">
              请当面提供给受邀成员；邀请码使用一次后失效。
            </p>
          </div>
        )}
      </Stack>
    </Sheet>
  );
}
