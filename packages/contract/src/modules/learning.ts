import { AppError } from "@talos/base";
import { z } from "zod";
import { defineEntity, defineMethod } from "../protocol/definitions.ts";
import { idSchema, okSchema, revSchema } from "../protocol/scalars.ts";

export const LEARNING_CORPUS_LIMIT = 512 * 1024;
export const LEARNING_DISCIPLINE_KEY = "learning.discipline";
export const learningWordSchema = z.tuple([
  idSchema,
  z.string().min(1).max(128),
  z.string().min(1).max(2000),
]);
export type LearningWord = z.infer<typeof learningWordSchema>;
export const learningCorpusSchema = z
  .object({
    id: idSchema,
    version: revSchema,
    encoding: z.literal("deflate-json-v1"),
    count: revSchema,
    data: z.string().max(LEARNING_CORPUS_LIMIT),
  })
  .strict();
export type LearningCorpus = z.infer<typeof learningCorpusSchema>;
export const learningCounterSchema = z
  .object({
    learned: revSchema,
    wrong: revSchema,
    answered: revSchema,
    lastAt: revSchema,
  })
  .strict();
export type LearningCounter = z.infer<typeof learningCounterSchema>;
export const learningProgressSchema = z
  .object({
    id: idSchema,
    devices: z.record(idSchema, learningCounterSchema),
    cleared: z.record(idSchema, revSchema),
  })
  .strict();
export type LearningProgress = z.infer<typeof learningProgressSchema>;
export const learningAnswerSchema = z
  .object({
    word: idSchema,
    device: idSchema,
    counter: learningCounterSchema,
    clear: z
      .object({ device: idSchema, through: revSchema })
      .strict()
      .optional(),
  })
  .strict();
export type LearningAnswer = z.infer<typeof learningAnswerSchema>;
export const learningCorpus = defineEntity({
  name: "learningCorpus",
  schema: learningCorpusSchema,
});
export const learningProgress = defineEntity({
  name: "learningProgress",
  schema: learningProgressSchema,
});
export const learning = Object.freeze({
  corpus: Object.freeze({
    import: defineMethod({
      name: "learning.corpus.import",
      args: z.object({ text: z.string().max(180 * 1024) }).strict(),
      result: z
        .object({
          imported: revSchema,
          skipped: revSchema,
          total: revSchema,
          version: revSchema,
        })
        .strict(),
      auth: "user",
      offline: "online",
    }),
  }),
  answer: Object.freeze({
    record: defineMethod({
      name: "learning.answer.record",
      args: learningAnswerSchema,
      result: okSchema,
      auth: "user",
      offline: "queue",
    }),
  }),
  discipline: Object.freeze({
    assign: defineMethod({
      name: "learning.discipline.assign",
      args: z.object({ user: idSchema, enabled: z.boolean() }).strict(),
      result: okSchema,
      auth: "user",
      offline: "online",
    }),
  }),
});

export function emptyLearningProgress(id: string): LearningProgress {
  return { id, devices: {}, cleared: {} };
}
const zero: LearningCounter = { learned: 0, wrong: 0, answered: 0, lastAt: 0 };
/** Product of grow-only counters. Wrong removals name an observed prefix per source. */
export function mergeLearningProgress(
  a: LearningProgress,
  b: LearningProgress,
): LearningProgress {
  if (a.id !== b.id) throw new AppError("E_INVALID", "单词进度不匹配");
  const devices: Record<string, LearningCounter> = {};
  const cleared: Record<string, number> = {};
  for (const key of [
    ...new Set([...Object.keys(a.devices), ...Object.keys(b.devices)]),
  ].sort()) {
    const x = a.devices[key] ?? zero;
    const y = b.devices[key] ?? zero;
    devices[key] = {
      learned: Math.max(x.learned, y.learned),
      wrong: Math.max(x.wrong, y.wrong),
      answered: Math.max(x.answered, y.answered),
      lastAt: Math.max(x.lastAt, y.lastAt),
    };
  }
  for (const key of [
    ...new Set([...Object.keys(a.cleared), ...Object.keys(b.cleared)]),
  ].sort())
    cleared[key] = Math.max(a.cleared[key] ?? 0, b.cleared[key] ?? 0);
  return { id: a.id, devices, cleared };
}
export function applyLearningAnswer(
  previous: LearningProgress,
  answer: LearningAnswer,
): LearningProgress {
  return mergeLearningProgress(previous, {
    id: answer.word,
    devices: { [answer.device]: answer.counter },
    cleared: answer.clear
      ? { [answer.clear.device]: answer.clear.through }
      : {},
  });
}
export function learningCounts(
  progress: LearningProgress,
): LearningCounter & { mastered: boolean } {
  const counts = { ...zero };
  for (const device of Object.keys(progress.devices)) {
    const counter = progress.devices[device]!;
    counts.learned += counter.learned;
    counts.wrong += Math.max(
      0,
      counter.wrong - (progress.cleared[device] ?? 0),
    );
    counts.answered += counter.answered;
    counts.lastAt = Math.max(counts.lastAt, counter.lastAt);
  }
  return { ...counts, mastered: counts.learned >= 2 && counts.wrong === 0 };
}
/** Build the next durable intent from the optimistic projection, never wall-time order. */
export function nextLearningAnswer(
  progress: LearningProgress,
  device: string,
  result: "correct" | "wrong" | "mastered",
  at: number,
): LearningAnswer {
  const before = progress.devices[device] ?? zero;
  const counter = {
    learned:
      before.learned +
      (result === "mastered" ? 2 : result === "correct" ? 1 : 0),
    wrong: before.wrong + (result === "wrong" ? 1 : 0),
    answered: before.answered + 1,
    lastAt: Math.max(before.lastAt, at),
  };
  const source =
    result !== "wrong"
      ? Object.keys(progress.devices)
          .sort()
          .find(
            (key) =>
              progress.devices[key]!.wrong > (progress.cleared[key] ?? 0),
          )
      : undefined;
  const answer: LearningAnswer = {
    word: progress.id,
    device,
    counter,
    ...(source
      ? {
          clear: {
            device: source,
            through: (progress.cleared[source] ?? 0) + 1,
          },
        }
      : {}),
  };
  if (!learningAnswerSchema.safeParse(answer).success)
    throw new AppError("E_INVALID", "学习计数超出范围");
  return answer;
}
