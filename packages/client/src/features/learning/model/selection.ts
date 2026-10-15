import { AppError } from "@talos/base";
import { learningCounts } from "@talos/contract";
import type { LearningWord } from "@talos/contract";
import type { LearningData } from "./corpus.ts";
import { wordProgress } from "./corpus.ts";
export type PracticeMode = "normal" | "speed" | "clear" | "discipline";
export interface Quiz {
  word: LearningWord;
  choices: readonly LearningWord[];
}
function draw(random: () => number): number {
  const n = random();
  if (n < 0 || n >= 1 || !Number.isFinite(n))
    throw new AppError("E_INVALID", "随机源无效");
  return n;
}
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(draw(random) * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export function selectQuiz(
  data: LearningData,
  mode: PracticeMode,
  random: () => number,
  previous?: string,
): Quiz | undefined {
  const available = data.words.filter((w) => w[0] !== previous);
  const all = available.length ? available : data.words;
  const wrong = all.filter(
    (w) => learningCounts(wordProgress(data, w[0])).wrong > 0,
  );
  const unlearned = all.filter(
    (w) => !learningCounts(wordProgress(data, w[0])).mastered,
  );
  let pool = all;
  const choice = draw(random);
  if (mode === "clear") {
    pool = data.words.filter(
      (w) => learningCounts(wordProgress(data, w[0])).wrong > 0,
    );
  } else if (wrong.length && choice < (mode === "discipline" ? 0.5 : 0.3))
    pool = wrong;
  else if (unlearned.length) pool = unlearned;
  if (!pool.length) return undefined;
  const weights = pool.map((w) =>
    Math.max(1, learningCounts(wordProgress(data, w[0])).wrong),
  );
  let target = draw(random) * weights.reduce((sum, n) => sum + n, 0);
  let word = pool[pool.length - 1]!;
  for (let i = 0; i < pool.length; i++) {
    target -= weights[i]!;
    if (target < 0) {
      word = pool[i]!;
      break;
    }
  }
  // Synonyms must not create indistinguishable correct/incorrect buttons.
  const definitions = new Set([word[2]]);
  const distractors = shuffle(data.words, random)
    .filter((w) => {
      if (w[0] === word[0] || definitions.has(w[2])) return false;
      definitions.add(w[2]);
      return true;
    })
    .slice(0, 3);
  return { word, choices: shuffle([word, ...distractors], random) };
}
