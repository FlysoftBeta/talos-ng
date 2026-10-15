import { Emitter } from "@talos/base";
import type { LearningData } from "./corpus.ts";
import { selectQuiz } from "./selection.ts";
import type { PracticeMode, Quiz } from "./selection.ts";
import { ActiveDeadline } from "./time.ts";
import type { LearningTime } from "./time.ts";
export interface PracticeSnapshot {
  quiz?: Quiz;
  phase: "question" | "saving" | "feedback" | "empty" | "error";
  total: number;
  correct: number;
  explicit: number;
  result?: "correct" | "wrong" | "mastered";
  error?: string;
}
export class PracticeSession {
  private readonly events = new Emitter<void>();
  private value: PracticeSnapshot = {
    phase: "empty",
    total: 0,
    correct: 0,
    explicit: 0,
  };
  private deadline?: ActiveDeadline;
  private feedback?: ActiveDeadline;
  private active = true;
  private disposed = false;
  constructor(
    readonly mode: PracticeMode,
    private readonly time: LearningTime,
    private readonly random: () => number,
    private readonly data: () => LearningData,
    private readonly record: (
      word: string,
      result: "correct" | "wrong" | "mastered",
    ) => Promise<void>,
    private readonly done?: () => void,
  ) {
    this.next();
  }
  getSnapshot = (): PracticeSnapshot => this.value;
  subscribe = (fn: () => void): (() => void) => this.events.on(fn);
  private publish(patch: Partial<PracticeSnapshot>): void {
    if (this.disposed) return;
    this.value = { ...this.value, ...patch };
    this.events.emit();
  }
  private next(): void {
    this.deadline?.close();
    this.feedback?.close();
    const quiz = selectQuiz(
      this.data(),
      this.mode,
      this.random,
      this.value.quiz?.word[0],
    );
    this.publish({
      quiz,
      phase: quiz ? "question" : "empty",
      result: undefined,
      error: undefined,
    });
    if (quiz && (this.mode === "speed" || this.mode === "clear")) {
      this.deadline = new ActiveDeadline(this.time, 5000, () => {
        void this.answer("wrong");
      });
      this.deadline.setActive(this.active);
    }
  }
  async answer(result: "correct" | "wrong" | "mastered"): Promise<void> {
    if (
      this.disposed ||
      !this.active ||
      !this.value.quiz ||
      this.value.phase !== "question"
    )
      return;
    this.deadline?.close();
    const word = this.value.quiz.word[0];
    this.publish({ phase: "saving", error: undefined });
    try {
      await this.record(word, result);
      if (this.disposed) return;
      this.publish({
        phase: "feedback",
        result,
        total: this.value.total + 1,
        correct: this.value.correct + (result !== "wrong" ? 1 : 0),
        explicit: this.value.explicit + (result === "mastered" ? 1 : 0),
      });
      this.feedback = new ActiveDeadline(
        this.time,
        this.mode === "clear" && result === "wrong" ? 2000 : 500,
        () => {
          if (this.mode === "discipline") this.done?.();
          else this.next();
        },
      );
      this.feedback.setActive(this.active);
    } catch (error) {
      this.publish({
        phase: "error",
        error: error instanceof Error ? error.message : "答案未能保存，请重试",
      });
    }
  }
  retry(): void {
    if (this.value.phase === "error") this.next();
  }
  setActive(active: boolean): void {
    this.active = active;
    this.deadline?.setActive(active);
    this.feedback?.setActive(active);
  }
  /** Ticks every 200 ms while a speed or clear countdown is shown; returns the cancel. */
  watchCountdown(listener: () => void): () => void {
    if (this.mode !== "speed" && this.mode !== "clear") return () => {};
    let id: unknown;
    const update = () => {
      listener();
      id = this.time.set(update, 200);
    };
    id = this.time.set(update, 200);
    return () => this.time.clear(id);
  }
  remaining(): number {
    return this.deadline?.remaining() ?? 0;
  }
  close(): void {
    this.disposed = true;
    this.deadline?.close();
    this.feedback?.close();
    this.events.clear();
  }
}
