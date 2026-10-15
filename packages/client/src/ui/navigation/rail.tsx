import type { ReactElement, ReactNode } from "react";
import type { LayoutProps } from "../layout/layout.tsx";
import { useToast } from "../feedback/toast.tsx";
import "./navigation.css";
export function Rail({ children }: LayoutProps): ReactElement {
  return (
    <nav className="rail" aria-label="主导航">
      {children}
    </nav>
  );
}
/** Pushes the following rail entries to the bottom. */
export function RailSpacer(): ReactElement {
  return <div className="rail-spacer" />;
}
export function RailItem({
  label,
  icon,
  badge,
  selected,
  disabledReason,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  badge?: number;
  selected?: boolean;
  disabledReason?: string;
  onClick?: () => void;
}): ReactElement {
  const toast = useToast();
  return (
    <button
      type="button"
      className={`rail-item${selected ? " is-selected" : ""}`}
      aria-label={label}
      aria-current={selected ? "page" : undefined}
      aria-disabled={!!disabledReason}
      title={disabledReason || label}
      onClick={() => (disabledReason ? toast(disabledReason) : onClick?.())}
    >
      <span className="rail-glyph">
        {icon}
        {!!badge && (
          <span className="rail-badge">{badge > 99 ? "99+" : badge}</span>
        )}
      </span>
      <span className="rail-label">{label}</span>
    </button>
  );
}
