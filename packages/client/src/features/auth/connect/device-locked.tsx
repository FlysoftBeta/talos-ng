import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import type { Admission } from "../../../core/auth/admission.ts";
import {
  LogoutController,
  admissionCopy,
  retryCountdown,
} from "../model/device-locked.ts";
import { DeviceLockedView } from "../view/device-locked.tsx";
export function DeviceLockedScreen({
  admission = { reason: "whitelist-required" },
  device,
  onRetry,
  logout,
  now = Date.now,
}: {
  admission?: Admission;
  device?: string;
  onRetry?: () => void;
  logout?: { name: string; reason?: string; run: () => Promise<void> };
  now?: () => number;
}): ReactElement {
  const [time, setTime] = useState(now);
  useEffect(() => {
    const timer = setInterval(() => setTime(now()), 250);
    return () => clearInterval(timer);
  }, [now]);
  const latest = useRef(logout);
  latest.current = logout;
  const [controller] = useState(
    () => new LogoutController(() => latest.current!.run()),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const countdown = retryCountdown(admission, time);
  const copy = admissionCopy[admission.reason];
  return (
    <DeviceLockedView
      title={copy.title}
      hint={copy.hint}
      countdown={countdown.visible ? countdown.label : undefined}
      retryDisabled={countdown.seconds > 0}
      device={device}
      onRetry={onRetry}
      logout={
        logout && {
          name: logout.name,
          reason: logout.reason,
          confirming: state.confirming,
          busy: state.busy,
          error: state.error,
          onAsk: controller.ask,
          onCancel: controller.cancel,
          onConfirm: controller.confirm,
        }
      }
    />
  );
}
