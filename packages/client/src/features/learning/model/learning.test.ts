import { describe, expect, it, vi } from "vitest";
import { deflateSync } from "fflate";
import { toBase64Url, utf8Encode } from "@talos/base";
import {
  applyLearningAnswer,
  emptyLearningProgress,
  nextLearningAnswer,
  learningCounts,
} from "@talos/contract";
import type { LearningWord } from "@talos/contract";
import { LearningDecoder, learningStats } from "./corpus.ts";
import type { LearningData } from "./corpus.ts";
import { selectQuiz, shuffle } from "./selection.ts";
import { ActiveDeadline } from "./time.ts";
import { PracticeSession } from "./session.ts";
import { learningModule } from "../module.ts";
const ids = Array.from(
  { length: 5 },
  (_, n) => `01ARZ3NDEKTSV4RRFFQ69G5FA${n}`,
);
const words: LearningWord[] = ids.map((id, n) => [id, `word${n}`, `释义${n}`]);
const data = (): LearningData => ({
  words,
  progress: new Map(),
  version: 1,
  cached: true,
});
class Time {
  at = 0;
  next = 0;
  tasks = new Map<number, { at: number; fn: () => void }>();
  now = () => this.at;
  set = (fn: () => void, ms: number): number => {
    const id = ++this.next;
    this.tasks.set(id, { at: this.at + ms, fn });
    return id;
  };
  clear = (id: unknown): void => {
    this.tasks.delete(id as number);
  };
  advance(ms: number): void {
    const target = this.at + ms;
    for (;;) {
      const due = [...this.tasks].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > target) break;
      this.at = due[1].at;
      this.tasks.delete(due[0]);
      due[1].fn();
    }
    this.at = target;
  }
}
describe("learning corpus and selectors", () => {
  it("decodes the compact corpus once, validates and distinguishes uncached from empty", () => {
    const decoder = new LearningDecoder();
    expect(decoder.decode([]).cached).toBe(false);
    const rows = [
      {
        scope: "learn",
        type: "learningCorpus",
        id: ids[0]!,
        rev: 1,
        deleted: false,
        data: {
          id: ids[0],
          version: 1,
          count: 5,
          encoding: "deflate-json-v1",
          data: toBase64Url(deflateSync(utf8Encode(JSON.stringify(words)))),
        },
      },
    ];
    const first = decoder.decode(rows);
    expect(first.words).toEqual(words);
    expect(decoder.decode(rows).words).toBe(first.words);
    rows[0]!.data.data = "broken";
    expect(decoder.decode(rows).error).toBeTruthy();
  });
  it("uses Shanghai dates and true totals, including empty corpus", () => {
    const d = data(),
      at = Date.UTC(2026, 9, 13, 16);
    const p = applyLearningAnswer(
      emptyLearningProgress(ids[0]!),
      nextLearningAnswer(
        emptyLearningProgress(ids[0]!),
        ids[1]!,
        "mastered",
        at,
      ),
    );
    d.progress = new Map([[p.id, p]]);
    expect(learningStats(d, at + 1000)).toMatchObject({
      total: 5,
      mastered: 1,
      today: 1,
      answers: 1,
      remaining: 4,
    });
    expect(learningStats(d, at - 1).today).toBe(0);
    expect(learningStats({ ...d, words: [] }, at).total).toBe(0);
  });
  it("always includes one correct choice and three distinct shuffled distractors", () => {
    for (let n = 0; n < 30; n++) {
      const quiz = selectQuiz(data(), "normal", () => n / 31)!;
      expect(quiz.choices).toHaveLength(4);
      expect(quiz.choices.filter((w) => w[0] === quiz.word[0])).toHaveLength(1);
      expect(new Set(quiz.choices.map((w) => w[2])).size).toBe(4);
    }
    expect(shuffle([1, 2, 3], () => 0)).toEqual([2, 3, 1]);
    expect(() => selectQuiz(data(), "normal", () => 1)).toThrow();
  });
  it("handles zero, one, synonym-only and completed clear pools", () => {
    expect(
      selectQuiz({ ...data(), words: [] }, "normal", () => 0),
    ).toBeUndefined();
    expect(
      selectQuiz({ ...data(), words: [words[0]!] }, "normal", () => 0)?.choices,
    ).toHaveLength(1);
    expect(
      selectQuiz(
        { ...data(), words: words.map((w) => [w[0], w[1], "same"]) },
        "normal",
        () => 0,
      )?.choices,
    ).toHaveLength(1);
    expect(selectQuiz(data(), "clear", () => 0)).toBeUndefined();
  });
  it("prioritizes weighted wrong words and avoids immediate repetition where possible", () => {
    const d = data();
    const p = emptyLearningProgress(ids[0]!);
    d.progress = new Map([
      [
        p.id,
        applyLearningAnswer(p, nextLearningAnswer(p, ids[1]!, "wrong", 1)),
      ],
    ]);
    expect(selectQuiz(d, "clear", () => 0.5)?.word[0]).toBe(p.id);
    expect(selectQuiz(d, "discipline", () => 0.1)?.word[0]).toBe(p.id);
    expect(selectQuiz(d, "normal", () => 0.1, p.id)?.word[0]).not.toBe(p.id);
  });
  it("optimistic replay after authoritative acknowledgement never double counts", () => {
    const answer = nextLearningAnswer(
      emptyLearningProgress(ids[0]!),
      ids[1]!,
      "mastered",
      1,
    );
    const reduce = learningModule.reducers["learning.answer.record"];
    const projected = reduce([], answer, { user: ids[2]!, op: ids[3]! });
    expect(reduce(projected, answer, { user: ids[2]!, op: ids[3]! })).toEqual(
      projected,
    );
    expect(reduce(projected, {}, { user: ids[2]!, op: ids[3]! })).toBe(
      projected,
    );
    expect(
      learningCounts(
        projected[0]!.data as ReturnType<typeof emptyLearningProgress>,
      ).learned,
    ).toBe(2);
  });
});
describe("active-use scheduling", () => {
  it("owns one timer across repeated activation and pauses hidden/locked time", () => {
    const time = new Time(),
      fire = vi.fn(),
      deadline = new ActiveDeadline(time, 300000, fire);
    for (let i = 0; i < 10; i++) deadline.setActive(true);
    expect(time.tasks.size).toBe(1);
    time.advance(120000);
    deadline.setActive(false);
    time.advance(999999);
    expect(fire).not.toHaveBeenCalled();
    expect(deadline.remaining()).toBe(180000);
    deadline.setActive(true);
    time.advance(179999);
    expect(fire).not.toHaveBeenCalled();
    time.advance(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(time.tasks.size).toBe(0);
    deadline.reset();
    deadline.setActive(true);
    deadline.close();
    time.advance(300000);
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it("normal practice has no timeout; duplicate taps save once, then advance after feedback", async () => {
    const time = new Time(),
      record = vi.fn(async () => {}),
      s = new PracticeSession("normal", time, () => 0.2, data, record);
    time.advance(10000);
    expect(record).not.toHaveBeenCalled();
    const word = s.getSnapshot().quiz!.word[0];
    await Promise.all([s.answer("correct"), s.answer("wrong")]);
    expect(record).toHaveBeenCalledTimes(1);
    expect(s.getSnapshot().phase).toBe("feedback");
    time.advance(499);
    expect(s.getSnapshot().quiz!.word[0]).toBe(word);
    time.advance(1);
    expect(s.getSnapshot().quiz!.word[0]).not.toBe(word);
    s.close();
    expect(time.tasks.size).toBe(0);
  });
  it("speed timeout records exactly one wrong answer and pauses with remaining duration", async () => {
    const time = new Time(),
      record = vi.fn(async () => {}),
      s = new PracticeSession("speed", time, () => 0.2, data, record);
    time.advance(2000);
    s.setActive(false);
    time.advance(90000);
    expect(record).not.toHaveBeenCalled();
    s.setActive(true);
    time.advance(2999);
    expect(record).not.toHaveBeenCalled();
    time.advance(1);
    await Promise.resolve();
    expect(record).toHaveBeenCalledWith(expect.any(String), "wrong");
    expect(s.getSnapshot().total).toBe(1);
    s.close();
  });
  it("clear drill waits two seconds after wrong, 500 ms after correct and ends when cleared", async () => {
    const time = new Time(),
      d = data(),
      p = emptyLearningProgress(ids[0]!);
    let value = applyLearningAnswer(
      p,
      nextLearningAnswer(p, ids[1]!, "wrong", 1),
    );
    d.progress = new Map([[p.id, value]]);
    const s = new PracticeSession(
      "clear",
      time,
      () => 0.2,
      () => d,
      async (_word, result) => {
        value = applyLearningAnswer(
          value,
          nextLearningAnswer(value, ids[1]!, result, time.now()),
        );
        d.progress = new Map([[p.id, value]]);
      },
    );
    await s.answer("wrong");
    time.advance(1999);
    expect(s.getSnapshot().phase).toBe("feedback");
    time.advance(1);
    await s.answer("correct");
    time.advance(500);
    await s.answer("correct");
    time.advance(500);
    expect(s.getSnapshot().phase).toBe("empty");
    s.close();
  });
  it("discipline closes only after a durable answer plus 500 ms", async () => {
    const time = new Time(),
      done = vi.fn(),
      s = new PracticeSession(
        "discipline",
        time,
        () => 0.2,
        data,
        async () => {},
        done,
      );
    await s.answer("correct");
    time.advance(499);
    expect(done).not.toHaveBeenCalled();
    time.advance(1);
    expect(done).toHaveBeenCalledOnce();
    s.close();
  });
  it("storage failure does not count an answer and disposal cancels delayed work", async () => {
    const time = new Time(),
      s = new PracticeSession(
        "speed",
        time,
        () => 0.2,
        data,
        async () => {
          throw new Error("磁盘已满");
        },
      );
    await s.answer("correct");
    expect(s.getSnapshot()).toMatchObject({
      phase: "error",
      total: 0,
      error: "磁盘已满",
    });
    s.retry();
    expect(s.getSnapshot().phase).toBe("question");
    s.close();
    time.advance(9000);
    expect(time.tasks.size).toBe(0);
  });
});
