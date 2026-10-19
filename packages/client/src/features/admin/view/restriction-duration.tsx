import type { ReactElement } from "react";
import { DurationInput } from "../../../ui/inputs/index.ts";
import type { DurationPreset } from "../../../ui/inputs/index.ts";
import { RESTRICTION_MAX_MINUTES } from "../model/duration.ts";
import type { DurationInputProps } from "../model/duration.ts";

const PRESETS: readonly DurationPreset[] = [
  { minutes: 10, label: "10 分钟" },
  { minutes: 60, label: "1 小时" },
  { minutes: 1440, label: "1 天" },
  { minutes: 10080, label: "7 天" },
  { minutes: 43200, label: "30 天" },
  { minutes: 0, label: "永久" },
];

/** Mute and ban length: presets, or days, hours and minutes; zero is permanent. */
export function RestrictionDuration(props: DurationInputProps): ReactElement {
  return (
    <DurationInput
      {...props}
      units={["days", "hours", "minutes"]}
      max={RESTRICTION_MAX_MINUTES}
      presets={PRESETS}
    />
  );
}
