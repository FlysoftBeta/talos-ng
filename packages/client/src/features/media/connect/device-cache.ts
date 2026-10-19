import { useEffect, useState } from "react";
import {
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { watchDeviceCache } from "../model/actions.ts";

/**
 * Whether `audio` is held on this device, re-checked as transfers progress. The last answer
 * stays until a re-check replaces it; an answer for another audio id never counts.
 */
export function useDeviceCache(audio: string | undefined): boolean {
  const runtime = useRuntime(),
    downloads = useClientSnapshot().status.transfers;
  const [known, setKnown] = useState<{ audio?: string; cached: boolean }>({
    cached: false,
  });
  useEffect(
    () =>
      watchDeviceCache(runtime, audio, (cached) =>
        setKnown((prev) =>
          prev.audio === audio && prev.cached === cached
            ? prev
            : { audio, cached },
        ),
      ),
    [runtime, audio, downloads],
  );
  return known.audio === audio && known.cached;
}
