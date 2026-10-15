import { useEffect, useRef } from "react";
import {
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import {
  MediaRetentionScheduler,
  mediaRetentionSignature,
} from "../model/retention.ts";
import { useMedia } from "./use-media.ts";

/** Runs the retention scheduler outside the player so retained audio resumes after a restart. */
export function MediaBackground(): null {
  const runtime = useRuntime(),
    snapshot = useClientSnapshot(),
    data = useMedia();
  const scheduler = useRef<MediaRetentionScheduler | undefined>(undefined);
  if (!scheduler.current)
    scheduler.current = new MediaRetentionScheduler(runtime);
  useEffect(() => {
    scheduler.current!.update({
      user: snapshot.user?.id,
      active: snapshot.gate === "app",
      offline: snapshot.status.connection === "offline",
      data,
    });
    return () => scheduler.current!.stop();
  }, [
    runtime,
    snapshot.user?.id,
    snapshot.gate,
    snapshot.status.connection,
    mediaRetentionSignature(data),
  ]);
  return null;
}
