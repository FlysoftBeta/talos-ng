import type {
  ReactElement,
  ReactNode,
  ChangeEvent,
  SelectHTMLAttributes,
} from "react";
import { Icon } from "../icon/icon.tsx";
import "./inputs.css";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
/** A picker that replaces the native select; renders identically on Chrome 70. */
export function SelectField({
  label,
  children,
  hideLabel = false,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  /** Keep the label for assistive technology only (compact toolbars). */
  hideLabel?: boolean;
}): ReactElement {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [localValue, setLocalValue] = useState(
    String(props.defaultValue ?? ""),
  );
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((child) => ({
      value: String((child.props as { value?: string }).value ?? ""),
      label: (child.props as { children?: ReactNode }).children,
      disabled: !!(child.props as { disabled?: boolean }).disabled,
    }));
  const selectedValue = String(props.value ?? localValue);
  const current = options.find((option) => option.value === selectedValue);
  return (
    <div
      ref={host}
      className={`field select-field${hideLabel ? " is-bare" : ""}`}
    >
      <span
        className={hideLabel ? "visually-hidden" : "field-label"}
        id={`${id}-label`}
      >
        {label}
      </span>
      <button
        type="button"
        id={id}
        className="input select-trigger"
        aria-labelledby={`${id}-label ${id}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={props.disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            const currentIndex = options.findIndex(
              (option) => option.value === selectedValue,
            );
            const delta = event.key === "ArrowDown" ? 1 : -1;
            const next =
              options[(currentIndex + delta + options.length) % options.length];
            if (next && !next.disabled) {
              setLocalValue(next.value);
              props.onChange?.({
                target: { value: next.value },
              } as ChangeEvent<HTMLSelectElement>);
            }
          }
        }}
      >
        <span className="select-value">
          {current?.label ?? options[0]?.label}
        </span>
        <Icon name="down" size={16} />
      </button>
      {open && (
        <div
          className="select-options"
          role="listbox"
          aria-labelledby={`${id}-label`}
        >
          {options.map((option) => (
            <button
              type="button"
              role="option"
              data-value={option.value}
              key={option.value}
              aria-selected={option.value === selectedValue}
              disabled={option.disabled}
              onClick={() => {
                setLocalValue(option.value);
                props.onChange?.({
                  target: { value: option.value },
                } as ChangeEvent<HTMLSelectElement>);
                setOpen(false);
              }}
            >
              <span className="select-option-label">{option.label}</span>
              {option.value === selectedValue && (
                <Icon name="check" size={16} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
