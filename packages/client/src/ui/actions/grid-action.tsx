import type { ReactElement } from "react";
import { IconButton } from "./button.tsx";
import type { IconName } from "../icon/icon.tsx";
export function GridAction({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: IconName;
}): ReactElement {
  const glyph =
    icon ??
    (/删除|清除|撤销/.test(label)
      ? "trash"
      : /查看|详情|成员/.test(label)
        ? "info"
        : "edit");
  return (
    <IconButton
      label={label}
      icon={glyph}
      onClick={onClick}
      disabled={disabled}
    />
  );
}
