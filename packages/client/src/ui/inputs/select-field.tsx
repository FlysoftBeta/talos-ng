import type {
  ReactElement,
  ReactNode,
  ChangeEvent,
  SelectHTMLAttributes,
} from "react";
import { Portal } from "../floating/layers.tsx";
import { useFloating, moveFloatingFocus } from "../floating/use-floating.ts";
import { Icon } from "../icon/icon.tsx";
import "./inputs.css";
import { Children, isValidElement, useId, useRef, useState } from "react";
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
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useFloating({
    open,
    anchor: trigger,
    surface: list,
    onClose: () => setOpen(false),
    matchWidth: true,
    focus: true,
  });
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
    <div className={`field select-field${hideLabel ? " is-bare" : ""}`}>
      <span
        className={hideLabel ? "visually-hidden" : "field-label"}
        id={`${id}-label`}
      >
        {label}
      </span>
      <button
        type="button"
        ref={trigger}
        id={id}
        className="input select-trigger"
        aria-labelledby={`${id}-label ${id}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-options` : undefined}
        disabled={props.disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="select-value">
          {current?.label ?? options[0]?.label}
        </span>
        <Icon name="down" size={16} />
      </button>
      {open && (
        <Portal>
          <div
            ref={list}
            id={`${id}-options`}
            tabIndex={-1}
            onKeyDown={moveFloatingFocus}
            className="select-options floating-surface"
            role="listbox"
            aria-labelledby={`${id}-label`}
          >
            {options.map((option) => (
              <button
                type="button"
                role="option"
                tabIndex={-1}
                data-value={option.value}
                key={option.value}
                aria-selected={option.value === selectedValue}
                disabled={option.disabled}
                onClick={() => {
                  trigger.current?.focus({ preventScroll: true });
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
        </Portal>
      )}
    </div>
  );
}
