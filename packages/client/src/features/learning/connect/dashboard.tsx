import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { contract } from "@talos/contract";
import {
  useCan,
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { learningStats } from "../model/corpus.ts";
import { DisciplineSetting, dashboardModel } from "../model/dashboard.ts";
import { denial } from "../model/pages.ts";
import { DashboardView } from "../view/dashboard.tsx";
import { useLearning } from "./provider.tsx";
export function Dashboard({ title }: { title: string }): ReactElement {
  const runtime = useRuntime(),
    state = useClientSnapshot(),
    { data, time, controller } = useLearning();
  const answer = useCan(contract.learning.answer.record),
    setting = useCan(contract.me.setting.set);
  const [discipline] = useState(() => new DisciplineSetting(runtime));
  const { error } = useSyncExternalStore(
    discipline.subscribe,
    discipline.getState,
    discipline.getState,
  );
  return (
    <DashboardView
      title={title}
      wrongCount={learningStats(data, time.now()).wrong}
      model={dashboardModel({
        data,
        now: time.now(),
        connection: state.status.connection,
        pending: state.status.pending,
        failed: state.status.failed,
        disciplineEnabled: controller.disciplineEnabled(),
      })}
      practiceDenied={denial(answer)}
      disciplineDenied={denial(setting)}
      error={error}
      onStart={controller.start}
      onOpenPage={controller.openPage}
      onDiscipline={discipline.set}
    />
  );
}
