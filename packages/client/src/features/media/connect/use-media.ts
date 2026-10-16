import {
  useClientSnapshot,
  useRepository,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { decodeMedia } from "../model/data.ts";
import type { MediaData } from "../model/data.ts";

/** Subscribes to the synchronized media rows and decodes them. */
export function useMedia(): MediaData {
  const runtime = useRuntime(),
    snapshot = useClientSnapshot();
  return decodeMedia(
    useRepository(runtime.repositories.get("media.data")!),
    snapshot.user?.id,
  );
}
