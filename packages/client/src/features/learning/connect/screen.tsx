import type { ReactElement } from "react";
import {
  useClientSnapshot,
  useGate,
} from "../../../platform/react/context.tsx";
import { screenModel } from "../model/pages.ts";
import { ScreenStateView, ScreenView } from "../view/screen.tsx";
import { Dashboard } from "./dashboard.tsx";
import { Quiz } from "./quiz.tsx";
import { useLearning } from "./provider.tsx";
import { WordList } from "./word-list.tsx";
export function LearningScreen(): ReactElement {
  const state = useClientSnapshot(),
    gate = useGate("learning");
  const { data, session, controller } = useLearning();
  const model = screenModel({
    gate,
    data,
    connection: state.status.connection,
    stack: state.nav.areas.learning.stack,
    hasSession: !!session,
  });
  const content = model.content;
  return (
    <ScreenView>
      {content.kind === "state" ? (
        <ScreenStateView
          title={model.title}
          state={content.state}
          hint={content.hint}
        />
      ) : content.kind === "practice" && session ? (
        <Quiz
          session={session}
          header={{ title: model.title, onEnd: controller.back }}
        />
      ) : content.kind === "wordList" ? (
        <WordList key={content.list} kind={content.list} title={model.title} />
      ) : (
        <Dashboard title={model.title} />
      )}
    </ScreenView>
  );
}
