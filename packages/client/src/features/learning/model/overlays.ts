import type { LearningData } from "./corpus.ts";
import type { LearningState } from "./controller.ts";

/** A discipline question may be dismissed only when it cannot be answered. */
export function disciplineDismissible(
  data: LearningData,
  canAnswer: boolean,
): boolean {
  return !data.words.length || !canAnswer;
}

export interface OverlaysModel {
  /** The dialogs exist only for a signed-in, unconcealed application. */
  visible: boolean;
  exitOpen: boolean;
  pauseOpen: boolean;
  disciplineOpen: boolean;
  /** Whether the discipline dialog may be dismissed (nothing to answer). */
  disciplineDismissible: boolean;
}

export function overlaysModel(input: {
  state: Pick<
    LearningState,
    "session" | "discipline" | "exit" | "paused" | "data"
  >;
  gate: string;
  concealed: boolean;
  canAnswer: boolean;
}): OverlaysModel {
  const { session, discipline, exit, paused, data } = input.state;
  return {
    visible: input.gate === "app" && !input.concealed,
    exitOpen: !!exit,
    pauseOpen: !!session && paused && !exit && !discipline,
    disciplineOpen: !!discipline,
    disciplineDismissible: disciplineDismissible(data, input.canAnswer),
  };
}
