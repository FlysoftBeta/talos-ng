import type { ReactElement } from "react";
import { useId, useRef, useState } from "react";
import { Portal } from "../floating/layers.tsx";
import { useFloating, moveFloatingFocus } from "../floating/use-floating.ts";
import { IconButton } from "../actions/button.tsx";
import { Icon } from "../icon/icon.tsx";
import type { IconName } from "../icon/icon.tsx";
import { useToast } from "../feedback/toast.tsx";

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabledReason?: string;
  checked?: boolean;
  hidden?: boolean;
}
/** Overflow and row actions in the current modal/application floating layer. */
export function Menu({
  label,
  items,
  icon = "more",
  size = "medium",
}: {
  label: string;
  items: readonly MenuItem[];
  icon?: IconName;
  size?: "medium" | "small";
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const visible = items.filter((item) => !item.hidden);
  useFloating({
    open,
    anchor: trigger,
    surface: list,
    onClose: () => setOpen(false),
    align: "end",
    focus: true,
  });
  if (!visible.length) return null;
  return (
    <span className="menu-host">
      <IconButton
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        label={label}
        icon={icon}
        size={size}
        pressed={open ? true : undefined}
        onClick={() => {
          setOpen(!open);
        }}
      />
      {open && (
        <Portal>
          <div
            id={id}
            ref={list}
            tabIndex={-1}
            onKeyDown={moveFloatingFocus}
            className="menu floating-surface"
            role="menu"
            aria-label={label}
          >
            {visible.map((item) => (
              <button
                key={item.label}
                type="button"
                tabIndex={-1}
                role={
                  item.checked === undefined ? "menuitem" : "menuitemcheckbox"
                }
                aria-checked={item.checked}
                aria-disabled={item.disabledReason ? true : undefined}
                className={`menu-item${item.danger ? " is-danger" : ""}${item.disabledReason ? " is-disabled" : ""}`}
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus({ preventScroll: true });
                  if (item.disabledReason) toast(item.disabledReason);
                  else item.onSelect();
                }}
              >
                <span className="menu-icon">
                  {item.icon && <Icon name={item.icon} size={18} />}
                </span>
                <span className="menu-label">{item.label}</span>
                {item.checked && (
                  <span className="menu-check">
                    <Icon name="check" size={16} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </Portal>
      )}
    </span>
  );
}
