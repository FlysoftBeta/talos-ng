import type { ReactElement } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "../actions/button.tsx";
import { Icon } from "../icon/icon.tsx";
import type { IconName } from "../icon/icon.tsx";
import { useToast } from "../feedback/toast.tsx";

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  /** Shown disabled; selecting explains the reason. */
  disabledReason?: string;
  /** Checked state for toggles (置顶, 免打扰). */
  checked?: boolean;
  hidden?: boolean;
}
/**
 * Overflow and row actions behind one trigger. The list is positioned `fixed` from the
 * trigger's rectangle so scroll containers cannot clip it; it flips up near the bottom.
 */
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
  const [place, setPlace] = useState<{ top: number; right: number }>();
  const host = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const visible = items.filter((item) => !item.hidden);
  useLayoutEffect(() => {
    if (!open || !host.current || !list.current) return;
    const rect = host.current.getBoundingClientRect();
    const height = list.current.offsetHeight;
    const below = rect.bottom + 4;
    const top =
      below + height > innerHeight - 8
        ? Math.max(8, rect.top - height - 4)
        : below;
    setPlace({ top, right: Math.max(8, innerWidth - rect.right) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (
        !host.current?.contains(event.target as Node) &&
        !list.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    const scroll = (event: Event) => {
      if (!list.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away, true);
    document.addEventListener("touchstart", away, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", scroll, true);
    list.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("touchstart", away, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open]);
  if (!visible.length) return null;
  return (
    <span className="menu-host" ref={host}>
      <IconButton
        label={label}
        icon={icon}
        size={size}
        pressed={open ? true : undefined}
        onClick={() => {
          setPlace(undefined);
          setOpen(!open);
        }}
      />
      {open && (
        <div
          ref={list}
          className="menu"
          role="menu"
          aria-label={label}
          style={
            place
              ? { top: place.top, right: place.right }
              : { visibility: "hidden" }
          }
        >
          {visible.map((item) => (
            <button
              key={item.label}
              type="button"
              role={
                item.checked === undefined ? "menuitem" : "menuitemcheckbox"
              }
              aria-checked={item.checked}
              aria-disabled={item.disabledReason ? true : undefined}
              className={`menu-item${item.danger ? " is-danger" : ""}${item.disabledReason ? " is-disabled" : ""}`}
              onClick={() => {
                setOpen(false);
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
      )}
    </span>
  );
}
