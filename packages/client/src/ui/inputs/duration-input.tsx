import type { ReactElement } from "react";
import "./inputs.css";
import {
  durationFieldMax,
  durationFields,
  durationWithField,
} from "./duration.ts";
import type { DurationPreset, DurationUnit } from "./duration.ts";

const UNIT_LABELS: Record<DurationUnit, string> = {
  days: "天",
  hours: "小时",
  minutes: "分钟",
};

/**
 * The one duration control: optional presets plus custom fields for the given
 * units. The value is whole minutes, clamped to `0..max`.
 */
export function DurationInput({
  minutes,
  onChange,
  units,
  max,
  presets,
  disabled = false,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  units: readonly DurationUnit[];
  max: number;
  presets?: readonly DurationPreset[];
  disabled?: boolean;
}): ReactElement {
  const fields = durationFields(minutes, units);
  return (
    <div className="duration">
      {presets && (
        <div className="segmented is-wrap" role="group" aria-label="持续时间">
          {presets.map((preset) => (
            <button
              key={preset.minutes}
              type="button"
              disabled={disabled}
              aria-pressed={minutes === preset.minutes}
              onClick={() => onChange(preset.minutes)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      <div className="duration-custom" role="group" aria-label="自定义持续时间">
        {(["days", "hours", "minutes"] as const)
          .filter((unit) => units.includes(unit))
          .map((unit) => (
            <label key={unit}>
              <input
                className="input"
                type="number"
                min={0}
                max={durationFieldMax(unit, units, max)}
                value={fields[unit]}
                disabled={disabled}
                onChange={(event) =>
                  onChange(
                    durationWithField(
                      minutes,
                      units,
                      unit,
                      event.target.value,
                      max,
                    ),
                  )
                }
              />
              <span>{UNIT_LABELS[unit]}</span>
            </label>
          ))}
      </div>
    </div>
  );
}
