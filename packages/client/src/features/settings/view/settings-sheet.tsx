import type { ReactElement, ReactNode } from "react";
import { Button, IconButton } from "../../../ui/actions/index.ts";
import {
  ConfirmDialog as Confirmation,
  Sheet,
} from "../../../ui/overlays/index.ts";
import { Group, GroupRow, Inline, Stack } from "../../../ui/layout/index.ts";
import { Mark, InlineNotice, OfflineHint } from "../../../ui/feedback/index.ts";
import { Switch } from "../../../ui/inputs/index.ts";
import { Segmented } from "../../../ui/navigation/index.ts";
import type { PreferenceRow } from "../model/preferences.ts";
import type { ConfirmDialog } from "../model/settings-sheet.ts";
import "./settings.css";

export function SettingsSheetView({
  open,
  preferences,
  preferencesDenied,
  accountActions,
  profile,
  error,
  about,
  confirmation,
  pins,
  onClose,
  onPreference,
}: {
  open: boolean;
  preferences: readonly PreferenceRow[];
  /** Why preferences cannot be changed. */
  preferencesDenied?: string;
  accountActions: {
    pinsDenied?: string;
    logoutDenied?: string;
    onLock: () => void;
    onPins: () => void;
    onLogout: () => void;
    onAbout: () => void;
    onReset: () => void;
  };
  /** The profile section (a connected component). */
  profile: ReactNode;
  error?: string;
  about: {
    open: boolean;
    rows: readonly { label: string; value: string }[];
    onClose: () => void;
  };
  confirmation: {
    open: boolean;
    busy: boolean;
    copy: ConfirmDialog;
    onDismiss: () => void;
    onConfirm: () => void;
  };
  /** The PIN replacement dialog (a connected component), when open. */
  pins: ReactNode;
  onClose: () => void;
  onPreference: (key: string, option: string) => void;
}): ReactElement {
  const { copy } = confirmation;
  const preference = (row: PreferenceRow) => {
    const toggle = row.key === "doNotDisturb";
    const label = toggle ? "免打扰" : row.label;
    const options =
      row.key === "idleLockMinutes"
        ? [row.options[row.options.length - 1]!, ...row.options.slice(0, -1)]
        : row.options;
    return (
      <GroupRow
        key={row.key}
        label={label}
        stacked={!toggle}
        hint={
          row.mark && <Mark state={row.mark.state} label={row.mark.label} />
        }
      >
        <OfflineHint label={label} reason={preferencesDenied}>
          {toggle ? (
            <Switch
              label={label}
              checked={row.value === "on"}
              disabled={preferencesDenied !== undefined}
              onChange={(checked) =>
                onPreference(row.key, checked ? "on" : "off")
              }
            />
          ) : (
            <Segmented
              block
              label={label}
              value={row.value}
              options={options}
              disabled={preferencesDenied !== undefined}
              onChange={(value) => onPreference(row.key, value)}
            />
          )}
        </OfflineHint>
      </GroupRow>
    );
  };
  const diagnostics = (standalone = false) => (
    <Group
      title={standalone ? undefined : "关于"}
      action={
        !standalone && (
          <IconButton
            icon="info"
            label="关于"
            onClick={accountActions.onAbout}
          />
        )
      }
    >
      {about.rows.map((row) => (
        <GroupRow
          key={row.label}
          label={row.label}
          stacked={row.label === "浏览器"}
        >
          <span
            className={`settings-value${row.label === "设备 ID" ? " settings-device" : ""}`}
          >
            {row.value}
          </span>
        </GroupRow>
      ))}
    </Group>
  );
  return (
    <>
      <Sheet
        open={open}
        title="设置"
        onClose={onClose}
        footer={
          <Inline>
            <Button icon="lock" onClick={accountActions.onLock}>
              锁定
            </Button>
            <Button
              variant="danger-ghost"
              disabledReason={accountActions.logoutDenied}
              onClick={accountActions.onLogout}
            >
              退出登录
            </Button>
          </Inline>
        }
      >
        <Stack space={5} className="settings-content">
          <Group title="账号">
            {profile}
            <GroupRow label="登录凭据">
              <Button
                variant="ghost"
                disabledReason={accountActions.pinsDenied}
                onClick={accountActions.onPins}
              >
                更换 PIN
              </Button>
            </GroupRow>
          </Group>
          <Group title="外观">
            {preferences
              .filter((row) => row.key === "theme" || row.key === "textSize")
              .map(preference)}
          </Group>
          <Group title="安全与提醒">
            {preferences
              .filter((row) => row.key !== "theme" && row.key !== "textSize")
              .map(preference)}
          </Group>
          {diagnostics()}
          <Group>
            <GroupRow label="清除账号与缓存">
              <Button variant="danger-ghost" onClick={accountActions.onReset}>
                重置本机数据
              </Button>
            </GroupRow>
          </Group>
          {error && <InlineNotice tone="failed">{error}</InlineNotice>}
        </Stack>
      </Sheet>
      {pins}
      <Sheet open={about.open} title="关于 Talos II" onClose={about.onClose}>
        {diagnostics(true)}
      </Sheet>
      <Confirmation
        open={confirmation.open}
        busy={confirmation.busy}
        objectName={copy.title}
        title={copy.title}
        destructive
        confirmLabel={copy.confirmLabel}
        onClose={confirmation.onDismiss}
        onConfirm={() => {
          if (!confirmation.busy) confirmation.onConfirm();
        }}
        message={
          <>
            <span>{copy.body}</span>
            {copy.warning && (
              <span className="settings-warning">{copy.warning}</span>
            )}
            {error && <span role="alert">{error}</span>}
          </>
        }
      />
    </>
  );
}
