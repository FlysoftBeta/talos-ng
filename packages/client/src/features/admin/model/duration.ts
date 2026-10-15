/** Whole number parsed from a typed duration field, clamped to `0..max`. */
export function parseDurationPart(value: string, max: number): number {
  return Math.min(max, Math.max(0, Math.floor(Number(value) || 0)));
}

const MINUTES_PER_DAY = 1440;
/** Restriction length in minutes split into the day and hour fields of the duration control. */
export function durationParts(minutes: number): {
  days: number;
  hours: number;
} {
  return {
    days: Math.floor(minutes / MINUTES_PER_DAY),
    hours: Math.floor((minutes % MINUTES_PER_DAY) / 60),
  };
}
export function durationMinutes(days: number, hours: number): number {
  return days * MINUTES_PER_DAY + hours * 60;
}
/** Absolute deadline of a restriction; zero minutes means permanent. */
export function durationUntil(minutes: number, now: number): number {
  return minutes === 0 ? Number.MAX_SAFE_INTEGER : now + minutes * 60_000;
}

/** Props of the duration control for a restriction length held in minutes. */
export function durationInputProps(
  minutes: number,
  setMinutes: (minutes: number) => void,
) {
  return {
    ...durationParts(minutes),
    onChange: (days: number, hours: number) =>
      setMinutes(durationMinutes(days, hours)),
    preset: minutes,
    onPresetChange: setMinutes,
    parse: parseDurationPart,
  };
}
export type DurationInputProps = ReturnType<typeof durationInputProps>;
