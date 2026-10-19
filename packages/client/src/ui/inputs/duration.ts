/** Custom fields a duration control can show, largest first. */
export type DurationUnit = "days" | "hours" | "minutes";
/** A one-tap choice; `minutes` is the duration it selects. */
export interface DurationPreset {
  readonly minutes: number;
  readonly label: string;
}
const ORDER: readonly DurationUnit[] = ["days", "hours", "minutes"];
const UNIT_MINUTES: Record<DurationUnit, number> = {
  days: 1440,
  hours: 60,
  minutes: 1,
};

/** Whole number parsed from a typed duration field, clamped to `0..max`. */
export function parseDurationPart(value: string, max: number): number {
  return Math.min(max, Math.max(0, Math.floor(Number(value) || 0)));
}
function shown(units: readonly DurationUnit[]): DurationUnit[] {
  return ORDER.filter((unit) => units.includes(unit));
}
/** Minutes split into the shown fields; the largest shown unit holds the excess. */
export function durationFields(
  minutes: number,
  units: readonly DurationUnit[],
): Record<DurationUnit, number> {
  const fields = { days: 0, hours: 0, minutes: 0 };
  let rest = Math.max(0, Math.floor(minutes));
  for (const unit of shown(units)) {
    fields[unit] = Math.floor(rest / UNIT_MINUTES[unit]);
    rest -= fields[unit] * UNIT_MINUTES[unit];
  }
  return fields;
}
/** Largest value a field accepts: a smaller unit wraps under a larger one shown beside it. */
export function durationFieldMax(
  unit: DurationUnit,
  units: readonly DurationUnit[],
  max: number,
): number {
  const larger = shown(units).some(
    (other) => UNIT_MINUTES[other] > UNIT_MINUTES[unit],
  );
  if (larger && unit === "hours") return 23;
  if (larger && unit === "minutes") return 59;
  return Math.floor(max / UNIT_MINUTES[unit]);
}
/** The duration after typing `text` into one field, clamped to `0..max` minutes. */
export function durationWithField(
  minutes: number,
  units: readonly DurationUnit[],
  unit: DurationUnit,
  text: string,
  max: number,
): number {
  const fields = durationFields(minutes, units);
  fields[unit] = parseDurationPart(text, durationFieldMax(unit, units, max));
  const total = shown(units).reduce(
    (sum, item) => sum + fields[item] * UNIT_MINUTES[item],
    0,
  );
  return Math.min(max, total);
}
