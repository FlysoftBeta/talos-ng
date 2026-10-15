import type {
  ButtonHTMLAttributes,
  MouseEvent,
  ReactElement,
  ReactNode,
} from "react";
import { Icon } from "../icon/icon.tsx";
import type { IconName } from "../icon/icon.tsx";
import { useToast } from "../feedback/toast.tsx";
import "./actions.css";

export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
/** Older call sites spoke MUI; mapped here so every button renders from one style. */
type LegacyVariant = "contained" | "outlined" | "text";
export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "color"
> {
  variant?: ButtonVariant | LegacyVariant;
  color?: "primary" | "error" | "inherit";
  size?: "medium" | "small";
  icon?: IconName;
  /** Stretch to the container width. */
  block?: boolean;
  /** Renders an anchor (downloads such as the CA certificate). */
  href?: string;
  /** Visible but inert; tapping explains why. */
  disabledReason?: string;
  busy?: boolean;
  children?: ReactNode;
}
function resolve(
  variant: ButtonProps["variant"],
  color: ButtonProps["color"],
): ButtonVariant {
  const danger = color === "error";
  if (variant === "contained" || variant === "primary")
    return danger ? "danger" : "primary";
  if (variant === "danger" || variant === "danger-ghost") return variant;
  if (variant === "outlined" || variant === "secondary")
    return danger ? "danger-ghost" : "secondary";
  if (variant === "text" || variant === "ghost")
    return danger ? "danger-ghost" : "ghost";
  return danger ? "danger-ghost" : "secondary";
}
export function Button({
  variant,
  color,
  size = "medium",
  icon,
  block = false,
  href,
  disabledReason,
  busy = false,
  className = "",
  children,
  type = "button",
  onClick,
  disabled,
  ...rest
}: ButtonProps): ReactElement {
  const toast = useToast();
  const kind = resolve(variant, color);
  const classes = `btn btn-${kind}${size === "small" ? " btn-sm" : ""}${block ? " btn-block" : ""}${busy ? " is-busy" : ""}${disabledReason ? " is-disabled" : ""} ${className}`;
  const content = (
    <>
      {busy ? (
        <Icon name="loading" size={size === "small" ? 16 : 18} spin />
      ) : (
        icon && <Icon name={icon} size={size === "small" ? 16 : 18} />
      )}
      {children !== undefined && children !== null && children !== false && (
        <span className="btn-label">{children}</span>
      )}
    </>
  );
  if (href)
    return (
      <a className={classes} href={href} download>
        {content}
      </a>
    );
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled || busy}
      aria-disabled={disabledReason ? true : undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (disabledReason) {
          event.preventDefault();
          toast(disabledReason);
          return;
        }
        onClick?.(event);
      }}
    >
      {content}
    </button>
  );
}
export function IconButton({
  label,
  icon,
  onClick,
  disabled,
  disabledReason,
  size = "medium",
  pressed,
  badge,
  tone,
  className = "",
  "data-testid": testId,
}: {
  label: string;
  icon: IconName;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  size?: "medium" | "small";
  /** Toggle buttons expose aria-pressed and show the selected tint. */
  pressed?: boolean;
  badge?: number;
  tone?: "danger";
  className?: string;
  "data-testid"?: string;
}): ReactElement {
  const toast = useToast();
  return (
    <button
      type="button"
      className={`icon-btn${size === "small" ? " icon-btn-sm" : ""}${tone ? ` icon-btn-${tone}` : ""}${disabledReason ? " is-disabled" : ""} ${className}`}
      aria-label={label}
      title={disabledReason ? `${label}（${disabledReason}）` : label}
      aria-pressed={pressed}
      aria-disabled={disabledReason ? true : undefined}
      disabled={disabled}
      data-testid={testId}
      onClick={() => (disabledReason ? toast(disabledReason) : onClick?.())}
    >
      <Icon name={icon} size={size === "small" ? 18 : 20} />
      {!!badge && (
        <span className="count-badge">{badge > 99 ? "99+" : badge}</span>
      )}
    </button>
  );
}
