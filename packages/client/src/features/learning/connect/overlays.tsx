import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { contract } from "@talos/contract";
import { useCan, useClientSnapshot } from "../../../platform/react/context.tsx";
import { denial } from "../model/pages.ts";
import { overlaysModel } from "../model/overlays.ts";
import type { PracticeSession } from "../model/session.ts";
import {
  DisciplineDialogView,
  ExitDialogView,
  PauseDialogView,
} from "../view/overlays.tsx";
import { ForbiddenView } from "../view/screen.tsx";
import { useLearning } from "./provider.tsx";
import { Quiz, SessionSummary } from "./quiz.tsx";
function ExitDialog({ session }: { session: PracticeSession }): ReactElement {
  const { exit, controller } = useLearning();
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return (
    <ExitDialogView
      open={!!exit}
      summary={<SessionSummary session={session} />}
      saving={state.phase === "saving"}
      onCancel={controller.cancelExit}
      onFinish={controller.finish}
    />
  );
}
export function LearningOverlays(): ReactElement {
  const learning = useLearning();
  const { session, discipline, controller } = learning;
  const state = useClientSnapshot(),
    can = useCan(contract.learning.answer.record);
  const model = overlaysModel({
    state: learning,
    gate: state.gate,
    concealed: state.concealed,
    canAnswer: can.ok,
  });
  if (!model.visible) return <></>;
  return (
    <>
      {session && <ExitDialog session={session} />}
      <PauseDialogView open={model.pauseOpen} onResume={controller.resume} />
      <DisciplineDialogView
        open={model.disciplineOpen}
        dismissible={model.disciplineDismissible}
        onClose={() => controller.requestCloseDiscipline(can.ok)}
        onEscape={() => controller.escapeDiscipline(can.ok)}
        onReturn={controller.closeDiscipline}
      >
        {discipline &&
          (can.ok ? (
            <Quiz session={discipline} />
          ) : (
            <ForbiddenView reason={denial(can) ?? ""} />
          ))}
      </DisciplineDialogView>
    </>
  );
}
