import { describe, expect, it } from "vitest";
import {
  applyLearningAnswer,
  emptyLearningProgress,
  learningCounts,
  mergeLearningProgress,
  nextLearningAnswer,
  learningAnswerSchema,
} from "./learning.ts";
import type { LearningAnswer } from "./learning.ts";
const word = "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  a = "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  b = "01ARZ3NDEKTSV4RRFFQ69G5FAX";
function random(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
describe("learning observed-error counters", () => {
  it("adds one for ordinary correct, two for explicit mastery, and demotes unresolved mistakes", () => {
    let p = emptyLearningProgress(word);
    p = applyLearningAnswer(p, nextLearningAnswer(p, a, "correct", 1));
    expect(learningCounts(p)).toMatchObject({ learned: 1, mastered: false });
    p = applyLearningAnswer(p, nextLearningAnswer(p, a, "mastered", 2));
    expect(learningCounts(p)).toMatchObject({ learned: 3, mastered: true });
    p = applyLearningAnswer(p, nextLearningAnswer(p, a, "wrong", 3));
    expect(learningCounts(p)).toMatchObject({
      learned: 3,
      wrong: 1,
      mastered: false,
      answered: 3,
    });
    p = applyLearningAnswer(p, nextLearningAnswer(p, a, "correct", 4));
    expect(learningCounts(p)).toMatchObject({ wrong: 0, mastered: true });
  });
  it("concurrent clears name the same error once and cannot erase a future error", () => {
    const zero = emptyLearningProgress(word);
    const wrong = applyLearningAnswer(
      zero,
      nextLearningAnswer(zero, a, "wrong", 1),
    );
    const x = applyLearningAnswer(
      wrong,
      nextLearningAnswer(wrong, a, "correct", 2),
    );
    const y = applyLearningAnswer(
      wrong,
      nextLearningAnswer(wrong, b, "correct", 2),
    );
    const merged = mergeLearningProgress(x, y);
    expect(learningCounts(merged)).toMatchObject({
      wrong: 0,
      learned: 2,
      answered: 3,
    });
    expect(
      learningCounts(
        applyLearningAnswer(merged, nextLearningAnswer(merged, a, "wrong", 3)),
      ).wrong,
    ).toBe(1);
  });
  it("clearing before the source arrives and duplicate/reordered delivery converge", () => {
    const zero = emptyLearningProgress(word);
    const error = nextLearningAnswer(zero, a, "wrong", 1);
    const clear = nextLearningAnswer(
      applyLearningAnswer(zero, error),
      b,
      "correct",
      2,
    );
    const forward = applyLearningAnswer(
      applyLearningAnswer(zero, error),
      clear,
    );
    expect(
      applyLearningAnswer(applyLearningAnswer(zero, clear), error),
    ).toEqual(forward);
    expect(applyLearningAnswer(forward, error)).toEqual(forward);
    expect(learningCounts(forward).wrong).toBe(0);
  });
  it("correct practice without observed errors never banks negative mistakes", () => {
    let p = emptyLearningProgress(word);
    for (let i = 0; i < 10; i++)
      p = applyLearningAnswer(p, nextLearningAnswer(p, a, "correct", i));
    p = applyLearningAnswer(p, nextLearningAnswer(p, b, "wrong", 10));
    expect(learningCounts(p).wrong).toBe(1);
  });
  it("does not mutate operands or depend on wall clock order", () => {
    const p = emptyLearningProgress(word);
    const one = applyLearningAnswer(p, nextLearningAnswer(p, a, "wrong", 100));
    const two = applyLearningAnswer(
      one,
      nextLearningAnswer(one, a, "correct", 1),
    );
    expect(p).toEqual(emptyLearningProgress(word));
    expect(learningCounts(two).lastAt).toBe(100);
  });
  it("rejects cross-word merges, invalid device IDs and overflow", () => {
    expect(() =>
      mergeLearningProgress(
        emptyLearningProgress(word),
        emptyLearningProgress(a),
      ),
    ).toThrow();
    expect(() =>
      nextLearningAnswer(emptyLearningProgress(word), "bad", "correct", 0),
    ).toThrow();
    expect(
      learningAnswerSchema.safeParse({
        word,
        device: a,
        counter: { learned: Infinity, wrong: 0, answered: 0, lastAt: 0 },
      }).success,
    ).toBe(false);
  });
  it("has associative, commutative and idempotent merges across 100 randomized offline histories", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rng = random(seed),
        zero = emptyLearningProgress(word);
      let x = zero,
        y = zero;
      const ops: LearningAnswer[] = [];
      for (let n = 0; n < 60; n++) {
        const first = rng() < 0.5,
          p = first ? x : y;
        const result =
          rng() < 0.4 ? "wrong" : rng() < 0.2 ? "mastered" : "correct";
        const op = nextLearningAnswer(p, first ? a : b, result, n);
        ops.push(op);
        if (first) x = applyLearningAnswer(x, op);
        else y = applyLearningAnswer(y, op);
        if (rng() < 0.15) {
          x = mergeLearningProgress(x, y);
          y = mergeLearningProgress(x, y);
        }
      }
      const expected = mergeLearningProgress(x, y);
      expect(mergeLearningProgress(y, x)).toEqual(expected);
      expect(mergeLearningProgress(expected, expected)).toEqual(expected);
      expect(mergeLearningProgress(x, mergeLearningProgress(y, zero))).toEqual(
        mergeLearningProgress(mergeLearningProgress(x, y), zero),
      );
      const shuffled = [...ops, ...ops];
      for (let n = shuffled.length - 1; n > 0; n--) {
        const j = Math.floor(rng() * (n + 1));
        [shuffled[n], shuffled[j]] = [shuffled[j]!, shuffled[n]!];
      }
      expect(shuffled.reduce(applyLearningAnswer, zero)).toEqual(expected);
      expect(learningCounts(expected).answered).toBe(60);
      expect(learningCounts(expected).wrong).toBeGreaterThanOrEqual(0);
    }
  });
});
