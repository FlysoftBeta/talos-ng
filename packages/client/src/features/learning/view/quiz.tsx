import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { PaneBody, PaneHeader } from "../../../ui/layout/index.ts";
import {
  OfflineHint,
  Progress,
  StatePanel,
} from "../../../ui/feedback/index.ts";
import { Icon } from "../../../ui/icon/index.ts";
import type { QuizModel, SummaryModel } from "../model/quiz.ts";
import { StatTiles } from "./stat.tsx";
import "./learning.css";

/** In the content pane a practice round has a header; in the discipline dialog it has none. */
export interface QuizHeader {
  title: string;
  onEnd: () => void;
}
function Framed({
  header,
  subtitle,
  children,
}: {
  header?: QuizHeader;
  subtitle?: string;
  children: ReactNode;
}): ReactElement {
  if (!header) return <>{children}</>;
  return (
    <>
      <PaneHeader
        title={header.title}
        subtitle={subtitle}
        actions={
          <Button variant="ghost" onClick={header.onEnd}>
            结束练习
          </Button>
        }
      />
      <PaneBody padded className="learn-practice">
        {children}
      </PaneBody>
    </>
  );
}
export function QuizView({
  model,
  header,
  timerValue,
  answerDenied,
  onAnswer,
  onRetry,
}: {
  model: QuizModel;
  header?: QuizHeader;
  /** Share of the answer time left (0..1) for timed modes. */
  timerValue?: number;
  answerDenied: string | undefined;
  onAnswer: (result: "correct" | "wrong" | "mastered") => void;
  onRetry: () => void;
}): ReactElement {
  const answerable = model.kind === "question" && model.answerable;
  const [picked, setPicked] = useState<string>();
  useEffect(() => {
    if (answerable) setPicked(undefined);
  }, [answerable]);
  if (model.kind === "empty")
    return (
      <Framed header={header}>
        <StatePanel state="empty" title={model.title} hint={model.hint} />
      </Framed>
    );
  if (model.kind === "error")
    return (
      <Framed header={header}>
        <StatePanel
          state="error"
          title="答案未能保存"
          hint={model.error}
          action={<Button onClick={onRetry}>重试本题</Button>}
        />
      </Framed>
    );
  const revealed = model.choices.some((choice) => choice.highlight);
  return (
    <Framed header={header} subtitle={model.progress}>
      <div className={`learn-quiz${header ? "" : " is-dialog"}`}>
        {model.timer && (
          <div className="learn-timer">
            <Progress value={timerValue} label="剩余时间" />
            <strong role="timer">{model.timer}</strong>
          </div>
        )}
        <div className="learn-prompt">
          <span className="learn-number">{model.number}</span>
          <h2 data-testid="learning.word">{model.word}</h2>
          <p>
            选择正确的中文释义
            {model.fewChoices && " · 当前词库可用不同释义不足四项"}
          </p>
        </div>
        <div className="learn-choices">
          {model.choices.map((choice, index) => {
            const wrong = revealed && !choice.highlight && picked === choice.id;
            const state = choice.highlight
              ? " is-correct"
              : wrong
                ? " is-wrong"
                : revealed
                  ? " is-faded"
                  : picked === choice.id
                    ? " is-picked"
                    : "";
            return (
              <OfflineHint
                key={choice.id}
                label={`选择释义 ${index + 1}`}
                reason={answerDenied}
                block
              >
                <button
                  type="button"
                  data-testid="learning.choice"
                  className={`learn-choice${state}`}
                  disabled={!model.answerable}
                  onClick={() => {
                    setPicked(choice.id);
                    onAnswer(choice.answer);
                  }}
                >
                  <span className="learn-choice-key">{choice.key}</span>
                  <span className="learn-choice-text">{choice.definition}</span>
                  {(choice.highlight || wrong) && (
                    <Icon
                      name={choice.highlight ? "check" : "close"}
                      size={18}
                    />
                  )}
                </button>
              </OfflineHint>
            );
          })}
        </div>
        <div className="learn-quiz-foot">
          <div
            className={`learn-feedback${model.feedback.tone ? ` is-${model.feedback.tone}` : ""}`}
            role="status"
          >
            {model.feedback.text}
          </div>
          {model.showMastered && (
            <OfflineHint label="标记为已掌握" reason={answerDenied}>
              <Button
                variant="ghost"
                size="small"
                disabled={!model.answerable}
                onClick={() => onAnswer("mastered")}
              >
                标记为已掌握
              </Button>
            </OfflineHint>
          )}
        </div>
      </div>
    </Framed>
  );
}
export function SummaryView({ model }: { model: SummaryModel }): ReactElement {
  const tiles = [
    { label: "已答", value: model.answered },
    { label: "答对", value: model.correct },
    { label: "正确率", value: model.accuracy },
  ];
  return (
    <div className="learn-summary">
      <StatTiles tiles={tiles} compact />
      <p className="learn-summary-note">
        主动标记掌握 {model.explicit}
        。已保存的答案会保留在本机，联网后自动同步。
      </p>
      {model.saving && (
        <p className="learn-summary-note" role="status">
          正在保存当前答案，请稍候…
        </p>
      )}
    </div>
  );
}
