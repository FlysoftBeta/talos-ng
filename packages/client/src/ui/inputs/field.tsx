import type { ReactElement, ReactNode } from "react";
import { useId } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Icon } from "../icon/icon.tsx";
import "./inputs.css";
/** Label above, control, hint or error below. Checkboxes render as a labelled check row. */
export function Field({
  label,
  hint,
  error,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
}): ReactElement {
  const id = useId();
  if (props.type === "checkbox")
    return (
      <Checkbox
        label={label}
        hint={hint}
        className={className}
        {...props}
        id={id}
      />
    );
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        {...props}
        id={id}
        className="input"
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${id}-hint` : undefined}
      />
      {(hint || error) && (
        <small
          id={`${id}-hint`}
          className={`field-hint${error ? " is-error" : ""}`}
        >
          {error || hint}
        </small>
      )}
    </div>
  );
}
export function TextArea({
  label,
  hint,
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
}): ReactElement {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <textarea {...props} id={id} className="input textarea" />
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  );
}
/** Search box with a leading glyph; the label is the accessible name and placeholder. */
export function SearchField({
  label = "搜索",
  placeholder,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
}): ReactElement {
  return (
    <div className={`search-field ${className}`}>
      <Icon name="search" size={16} />
      <input
        type="search"
        {...props}
        className="input"
        aria-label={label}
        placeholder={placeholder || label}
      />
    </div>
  );
}
export function Checkbox({
  label,
  hint,
  className = "",
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  hint?: string;
}): ReactElement {
  const own = useId();
  const inputId = id || own;
  return (
    <label className={`check ${className}`} htmlFor={inputId}>
      <input {...props} id={inputId} type="checkbox" className="check-input" />
      <span className="check-box" aria-hidden="true">
        <Icon name="check" size={14} />
      </span>
      <span className="check-copy">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}
/** On/off toggle for settings (a checkbox with the switch look). */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch-thumb" />
    </button>
  );
}
