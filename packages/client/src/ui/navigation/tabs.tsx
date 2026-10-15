import type { ReactElement } from "react";
import type { SegmentedOption } from "./segmented.tsx";
import "./navigation.css";
/** Switches between views of one pane (underlined labels under a header). */
export function Tabs<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
}): ReactElement {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
