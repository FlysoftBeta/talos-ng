/** Absolute deadline of a restriction; zero minutes means permanent. */
export function durationUntil(minutes: number, now: number): number {
  return minutes === 0 ? Number.MAX_SAFE_INTEGER : now + minutes * 60_000;
}
/** Longest custom restriction: 30 days 23 hours 59 minutes. */
export const RESTRICTION_MAX_MINUTES = 31 * 1440 - 1;

/** A restriction length in minutes and its setter, as the duration control takes them. */
export function durationInputProps(
  minutes: number,
  setMinutes: (minutes: number) => void,
) {
  return { minutes, onChange: setMinutes };
}
export type DurationInputProps = ReturnType<typeof durationInputProps>;
