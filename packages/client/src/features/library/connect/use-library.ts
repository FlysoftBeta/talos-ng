import { useRepository, useRuntime } from "../../../platform/react/context.tsx";
import { decodeLibrary } from "../model/library-data.ts";
import type { LibraryData } from "../model/library-data.ts";

/** Subscribes to the synchronized library rows and decodes them. */
export function useLibrary(): LibraryData {
  const runtime = useRuntime();
  return decodeLibrary(
    useRepository(runtime.repositories.get("library.data")!),
  );
}
