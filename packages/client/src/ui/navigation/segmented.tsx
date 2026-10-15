import type { ReactElement } from "react";
import "./navigation.css";
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}
/** A compact exclusive choice (two to five options); native buttons keep Chrome 70 keyboard support. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  block = false,
}: {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Stretch the options to fill the width. */
  block?: boolean;
}): ReactElement {
  return (
    <div
      className={`segmented${block ? " is-block" : ""}`}
      role="group"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
