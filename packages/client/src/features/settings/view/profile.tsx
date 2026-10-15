import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Field } from "../../../ui/inputs/index.ts";
import { Avatar, GroupRow, Inline } from "../../../ui/layout/index.ts";
export function ProfileSettingsView({
  handle,
  name,
  busy,
  message,
  denied,
  canSave,
  onHandle,
  onName,
  onSave,
}: {
  handle: string;
  name: string;
  busy: boolean;
  message?: string;
  /** Why editing is unavailable. */
  denied?: string;
  canSave: boolean;
  onHandle: (value: string) => void;
  onName: (value: string) => void;
  onSave: () => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const locked = denied !== undefined || busy;
  return (
    <>
      <GroupRow
        label={
          <Inline>
            <Avatar name={name} />
            <span className="settings-account">
              <strong>{name}</strong>
              <small>@{handle}</small>
            </span>
          </Inline>
        }
      >
        <Button variant="ghost" onClick={() => setEditing(!editing)}>
          {editing ? "收起资料" : "编辑资料"}
        </Button>
      </GroupRow>
      {editing && (
        <div className="settings-profile">
          {denied !== undefined && (
            <p className="muted" role="status">
              {denied}
            </p>
          )}
          <Field
            label="账号标识"
            value={handle}
            maxLength={20}
            disabled={locked}
            onChange={(event) => onHandle(event.target.value)}
          />
          <Field
            label="显示名称"
            value={name}
            maxLength={30}
            disabled={locked}
            onChange={(event) => onName(event.target.value)}
          />
          <div className="settings-profile-actions">
            <Button variant="contained" disabled={!canSave} onClick={onSave}>
              保存个人资料
            </Button>
          </div>
          {message && <p role="status">{message}</p>}
        </div>
      )}
    </>
  );
}
