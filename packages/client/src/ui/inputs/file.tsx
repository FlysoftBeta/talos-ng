import type { ReactElement } from "react";
import { useRef, useState } from "react";
import { Button, IconButton } from "../actions/button.tsx";
import type { IconName } from "../icon/icon.tsx";
import "./inputs.css";
export function FileButton({
  label,
  accept,
  disabled,
  disabledReason,
  icon = "image",
  onFile,
}: {
  label: string;
  accept?: string;
  disabled?: boolean;
  disabledReason?: string;
  icon?: IconName;
  onFile: (file: File | undefined) => void;
}): ReactElement {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        style={{ display: "none" }}
        aria-label={label}
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <IconButton
        label={label}
        icon={icon}
        disabled={disabled}
        disabledReason={disabledReason}
        onClick={() => input.current?.click()}
      />
    </>
  );
}
export function FileField({
  label,
  accept,
  disabled,
  onFile,
}: {
  label: string;
  accept?: string;
  disabled?: boolean;
  onFile: (file: File | undefined) => void;
}): ReactElement {
  const input = useRef<HTMLInputElement>(null),
    [name, setName] = useState("");
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <input
        ref={input}
        type="file"
        style={{ display: "none" }}
        hidden
        accept={accept}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          setName(file?.name ?? "");
          onFile(file);
        }}
      />
      <div className="file-field">
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          选择文件
        </Button>
        <span className={`file-name${name ? "" : " muted"}`}>
          {name || "尚未选择文件"}
        </span>
      </div>
    </div>
  );
}
