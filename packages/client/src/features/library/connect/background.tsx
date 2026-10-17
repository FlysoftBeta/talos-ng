import { useEffect, useRef } from "react";
import {
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { documentReadPort } from "../adapters/document-read.ts";
import { RetentionScheduler, retentionSignature } from "../model/retention.ts";
import { useLibrary } from "./use-library.ts";

/** Runs the retention scheduler outside the reader so downloads resume after a restart. */
export function LibraryBackground(): null {
  const runtime = useRuntime(),
    snapshot = useClientSnapshot(),
    data = useLibrary();
  const scheduler = useRef<RetentionScheduler | undefined>(undefined);
  if (!scheduler.current)
    scheduler.current = new RetentionScheduler({
      ...documentReadPort(runtime),
      getLocal: runtime.getLocal,
      setLocal: runtime.setLocal,
      releaseFiles: runtime.releaseFiles,
      collectFiles: runtime.collectFiles,
      hasFile: runtime.hasFile,
      retainFile: runtime.retainFile,
      downloadFile: runtime.downloadFile,
      setTransfer: runtime.setTransfer,
      time: runtime.time,
      delay: runtime.delay,
      clearDelay: runtime.clearDelay,
    });
  const user = snapshot.user?.id;
  useEffect(() => {
    scheduler.current!.update({
      user,
      offline: snapshot.status.connection === "offline",
      syncing:
        snapshot.cacheReady !== true ||
        snapshot.status.connection === "syncing" ||
        snapshot.status.connection === "connecting",
      active: !!snapshot.user && snapshot.gate === "app",
      data,
    });
    return () => scheduler.current!.stop();
  }, [
    runtime,
    user,
    snapshot.gate,
    snapshot.cacheReady,
    snapshot.status.connection,
    retentionSignature(data),
  ]);
  return null;
}
