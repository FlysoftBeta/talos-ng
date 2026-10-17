import type { ReactElement } from "react";
import {
  useAccessEntries,
  useAccessHistory,
} from "../platform/react/use-access-history.ts";
import { useRuntime } from "../platform/react/context.tsx";
import type { AreaId } from "../core/navigation/index.ts";
import { Icon } from "../ui/icon/index.ts";
import { useToast } from "../ui/feedback/index.ts";
import { RailItem } from "../ui/navigation/index.ts";
import { useLauncher } from "../features/launcher/index.ts";
import type { LauncherItem } from "../features/launcher/index.ts";
import { bindMediaControls, useMediaPlayer } from "../features/media/index.ts";
import { kindLabel, recentOverview } from "../features/recent/index.ts";
import { useRecentTargets } from "./recent.tsx";

const RECENT_SHOWN = 6;

/**
 * Rail toggle for the always-on-top quick-launch window (Picture-in-Picture).
 * It lists the areas the user can reach plus the top recent items, and renders
 * nothing where the browser lacks the API.
 */
export function LauncherEntry({
  areas,
}: {
  areas: readonly { id: AreaId; title: string }[];
}): ReactElement | null {
  const toast = useToast(),
    runtime = useRuntime(),
    player = useMediaPlayer(),
    history = useAccessHistory(),
    entries = useAccessEntries(history),
    { resolvers, open } = useRecentTargets();
  const items: LauncherItem[] = [
    ...areas.map((area) => ({
      id: `app:${area.id}`,
      group: "app" as const,
      title: area.title,
      hint: "",
    })),
    ...recentOverview(entries, resolvers, Date.now())
      .slice(0, RECENT_SHOWN)
      .map((entry) => ({
        id: `${entry.kind}:${entry.id}`,
        group: "recent" as const,
        title: entry.title,
        hint: kindLabel[entry.kind],
      })),
  ];
  const launcher = useLauncher(
    items,
    (item) => {
      const at = item.id.indexOf(":"),
        kind = item.id.slice(0, at),
        id = item.id.slice(at + 1);
      if (kind === "app")
        runtime.dispatch({ type: "switchArea", area: id as AreaId });
      else open[kind as keyof typeof open](id);
    },
    () => bindMediaControls(player),
  );
  if (!launcher.supported) return null;
  return (
    <RailItem
      label="悬浮启动器"
      icon={<Icon name="monitor" size={22} />}
      selected={launcher.active}
      onClick={() => launcher.toggle(toast)}
    />
  );
}
