import { useState } from "react";
import type { ReactElement } from "react";
import type { RuntimePort as ClientRuntime } from "../core/runtime-port.ts";
import type { ClientSnapshot } from "../core/lifecycle/snapshot.ts";
import { RuntimeProvider } from "../platform/react/context.tsx";
import { createNav } from "../core/navigation/index.ts";
import { InvitationSheet, OnboardingScreen } from "../features/auth/index.ts";
import { PinReplacement, SettingsSheet } from "../features/settings/index.ts";
import type { StatusViewModel } from "../core/status/model.ts";

/** Deterministic visual fixtures; excluded from the installed production shell. */
export function AuthShowcase({
  preview,
  status,
}: {
  preview: string;
  status: StatusViewModel;
}): ReactElement {
  const [runtime] = useState(() => {
    const snapshot = {
      gate: "onboarding",
      concealed: false,
      busy: false,
      device: "gallery-tablet-01",
      nav: createNav(),
      user: {
        id: "gallery-user",
        handle: "lin_tongxue",
        name: "林同学",
        roles: ["root"],
        features: [],
      },
      status: { ...status, pending: 2 },
    } as unknown as ClientSnapshot;
    // Gallery-only adapter: it has no database, transport, timer, or global store.
    return {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
      setting: (_key: string, fallback: unknown) => fallback,
      settingMark: () => undefined,
      can: () => ({ ok: true }),
      createInvitation: async () => ({
        id: "gallery-invitation",
        pin: "482619",
        expires: 1791907200000,
      }),
      onboard: async () => true,
      replacePins: async () => {},
      setSetting: async () => {},
      estimateStorage: async () => {},
      localOperationCount: async () => 2,
    } as unknown as ClientRuntime;
  });
  return (
    <RuntimeProvider runtime={runtime}>
      {preview === "onboarding" ? (
        <OnboardingScreen />
      ) : preview === "pins" ? (
        <PinReplacement onClose={() => {}} />
      ) : preview === "invitation" ? (
        <InvitationSheet open onClose={() => {}} />
      ) : (
        <SettingsSheet open onClose={() => {}} />
      )}
    </RuntimeProvider>
  );
}
