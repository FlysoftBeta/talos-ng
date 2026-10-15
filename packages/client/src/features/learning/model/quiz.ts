import type { PracticeSnapshot } from "./session.ts";
import type { PracticeMode } from "./selection.ts";

export type QuizModel =
  | { kind: "empty"; title: string; hint: string }
  | { kind: "error"; error: string | undefined }
  | {
      kind: "question";
      number: string;
      progress: string;
      /** Remaining seconds label for timed modes. */
      timer?: string;
      word: string;
      fewChoices: boolean;
      choices: Array<{
        id: string;
        key: string;
        definition: string;
        /** What choosing this option records. */
        answer: "correct" | "wrong";
        highlight: boolean;
      }>;
      /** Choice buttons are enabled only while a question is open. */
      answerable: boolean;
      showMastered: boolean;
      feedback: { text: string; tone?: "failed" | "confirmed" };
    };

/** Everything the quiz view shows for one session snapshot. */
export function quizModel(
  mode: PracticeMode,
  state: PracticeSnapshot,
  remainingMs: number,
): QuizModel {
  if (state.phase === "empty")
    return {
      kind: "empty",
      title: mode === "clear" ? "错题已全部清理完毕" : "暂无单词",
      hint:
        mode === "clear"
          ? "每一次认真复习，都算数。可以查看本次练习总结。"
          : "请联系功能管理员导入词库；当前可以安全返回。",
    };
  if (state.phase === "error") return { kind: "error", error: state.error };
  const quiz = state.quiz!;
  const feedback = state.phase === "feedback";
  return {
    kind: "question",
    number: `第 ${state.total + (feedback ? 0 : 1)} 题`,
    progress: `已答 ${state.total} · 答对 ${state.correct}`,
    timer:
      mode === "speed" || mode === "clear"
        ? `${(remainingMs / 1000).toFixed(1)} 秒`
        : undefined,
    word: quiz.word[1],
    fewChoices: quiz.choices.length < 4,
    choices: quiz.choices.map((word, index) => ({
      id: word[0],
      key: String.fromCharCode(65 + index),
      definition: word[2],
      answer: word[0] === quiz.word[0] ? "correct" : "wrong",
      highlight: feedback && word[0] === quiz.word[0],
    })),
    answerable: state.phase === "question",
    showMastered: mode !== "discipline",
    feedback: feedback
      ? {
          text: `${state.result === "wrong" ? "再记一次" : "回答正确"} · ${quiz.word[2]}${state.result === "mastered" ? " · 掌握计数 +2" : ""}`,
          tone: state.result === "wrong" ? "failed" : "confirmed",
        }
      : {
          text:
            state.phase === "saving"
              ? "正在保存到本机…"
              : "答案会先保存到本机，联网后自动同步",
        },
  };
}

export interface SummaryModel {
  answered: string;
  correct: string;
  accuracy: string;
  explicit: string;
  saving: boolean;
}

export function summaryModel(state: PracticeSnapshot): SummaryModel {
  return {
    answered: `${state.total} 题`,
    correct: `${state.correct} 题`,
    accuracy: `${state.total ? Math.round((state.correct / state.total) * 100) : 0}%`,
    explicit: `${state.explicit} 次`,
    saving: state.phase === "saving",
  };
}
