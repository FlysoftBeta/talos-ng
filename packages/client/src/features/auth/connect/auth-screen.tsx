import type { ReactElement } from "react";
import type { StatusViewModel } from "../../../core/status/model.ts";
import { loginHeading, loginIntro } from "../model/login.ts";
import { AuthScreenView } from "../view/auth-screen.tsx";
import { PinEntry } from "./pin-entry.tsx";
export interface AuthScreenProps {
  locked?: boolean;
  name?: string;
  error?: string;
  busy?: boolean;
  device?: string;
  lockReason?: "manual" | "idle";
  status: StatusViewModel;
  onLogin: (pin: string) => void;
  onStatus?: () => void;
}
export function AuthScreen({
  locked = false,
  name,
  error,
  busy = false,
  device,
  lockReason,
  status,
  onLogin,
  onStatus,
}: AuthScreenProps): ReactElement {
  return (
    <AuthScreenView
      locked={locked}
      heading={loginHeading(locked, lockReason)}
      intro={loginIntro(locked, name)}
      device={device}
      status={status}
      onStatus={onStatus}
    >
      <PinEntry busy={busy} error={error} onComplete={onLogin} />
    </AuthScreenView>
  );
}
