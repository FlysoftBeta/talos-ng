import type { ReactElement } from "react";
import { useClientSnapshot } from "../../../platform/react/context.tsx";
import { learningStats } from "../model/corpus.ts";
import { sidebarModel } from "../model/pages.ts";
import { SidebarView } from "../view/sidebar.tsx";
import { useLearning } from "./provider.tsx";
export function LearningSidebar(): ReactElement {
  const snapshot = useClientSnapshot(),
    { data, time, controller } = useLearning();
  const counts = learningStats(data, time.now());
  return (
    <SidebarView
      model={sidebarModel(snapshot.nav.areas.learning.stack, data)}
      counts={{ wrong: counts.wrong, mastered: counts.mastered }}
      onOpen={controller.openPage}
    />
  );
}
