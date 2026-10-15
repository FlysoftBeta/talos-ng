import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { contract } from "@talos/contract";
import { useCan } from "../../../platform/react/context.tsx";
import { denial } from "../model/pages.ts";
import { quizModel, summaryModel } from "../model/quiz.ts";
import type { PracticeSession } from "../model/session.ts";
import { QuizView, SummaryView } from "../view/quiz.tsx";
import type { QuizHeader } from "../view/quiz.tsx";
/** Seconds per answer in the timed modes (docs/product/learning.md). */
const ANSWER_MS = 5000;
export function Quiz({
  session,
  header,
}: {
  session: PracticeSession;
  header?: QuizHeader;
}): ReactElement {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const can = useCan(contract.learning.answer.record);
  const [, tick] = useState(0);
  useEffect(() => session.watchCountdown(() => tick((n) => n + 1)), [session]);
  return (
    <QuizView
      model={quizModel(session.mode, state, session.remaining())}
      header={header}
      timerValue={session.remaining() / ANSWER_MS}
      answerDenied={denial(can)}
      onAnswer={(result) => {
        void session.answer(result);
      }}
      onRetry={() => session.retry()}
    />
  );
}
export function SessionSummary({
  session,
}: {
  session: PracticeSession;
}): ReactElement {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return <SummaryView model={summaryModel(state)} />;
}
