import { useEffect, useState } from "react";
import type { ChatState, CommunityConversation } from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
import {
  useRuntime,
  useClientSnapshot,
} from "../../../platform/react/context.tsx";
import { RetentionController } from "../model/retention.ts";
export function useRetention(
  states: readonly ChatState[],
  groups: readonly CommunityConversation[],
  rows: readonly StoredRow[],
): void {
  const runtime = useRuntime();
  const snapshot = useClientSnapshot();
  const [model] = useState(() => new RetentionController(runtime));
  useEffect(
    () => model.update(states, groups, rows),
    [model, states, groups, rows, snapshot],
  );
  useEffect(() => model.dispose, [model]);
}
