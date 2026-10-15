import type { ReactElement } from "react";
import "./inputs.css";
export function DurationInput({
  days,
  hours,
  onChange,
  disabled = false,
  preset,
  onPresetChange,
  parse,
}: {
  days: number;
  hours: number;
  onChange: (days: number, hours: number) => void;
  disabled?: boolean;
  preset?: number;
  onPresetChange?: (minutes: number) => void;
  /** Converts the typed text to a whole number clamped to `0..max`. */
  parse: (value: string, max: number) => number;
}): ReactElement {
  const presets = onPresetChange ? (
    <div className="segmented is-wrap" role="group" aria-label="持续时间">
      {[
        [10, "10 分钟"],
        [60, "1 小时"],
        [1440, "1 天"],
        [10080, "7 天"],
        [43200, "30 天"],
        [0, "永久"],
      ].map(([minutes, label]) => (
        <button
          key={minutes}
          type="button"
          disabled={disabled}
          aria-pressed={preset === minutes}
          onClick={() => onPresetChange(minutes as number)}
        >
          {label}
        </button>
      ))}
    </div>
  ) : null;
  return (
    <div className="duration">
      {presets}
      <div className="duration-custom" role="group" aria-label="自定义持续时间">
        <label>
          <input
            className="input"
            type="number"
            min={0}
            max={30}
            value={days}
            disabled={disabled}
            onChange={(event) => onChange(parse(event.target.value, 30), hours)}
          />
          <span>天</span>
        </label>
        <label>
          <input
            className="input"
            type="number"
            min={0}
            max={23}
            value={hours}
            disabled={disabled}
            onChange={(event) => onChange(days, parse(event.target.value, 23))}
          />
          <span>小时</span>
        </label>
      </div>
    </div>
  );
}
