import { AppError, fromBase64Url, utf8Decode } from "@talos/base";
import { inflateSync } from "fflate";
import {
  emptyLearningProgress,
  learningCorpusSchema,
  learningCounts,
  learningProgressSchema,
  learningWordSchema,
  z,
} from "@talos/contract";
import type { LearningProgress, LearningWord } from "@talos/contract";
import type { StoredRow } from "../../../core/data/db.ts";
export interface LearningData {
  words: readonly LearningWord[];
  progress: ReadonlyMap<string, LearningProgress>;
  version: number;
  cached: boolean;
  error?: string;
}
/** One decoder per mounted feature owner; no process-global cache or mutable corpus. */
export class LearningDecoder {
  private packed?: string;
  private words: readonly LearningWord[] = [];
  decode(rows: readonly StoredRow[]): LearningData {
    const progress = new Map<string, LearningProgress>();
    for (const row of rows)
      if (row.type === "learningProgress") {
        const parsed = learningProgressSchema.safeParse(row.data);
        if (parsed.success) progress.set(parsed.data.id, parsed.data);
      }
    const row = rows.find((r) => r.type === "learningCorpus");
    if (!row) return { words: [], progress, version: 0, cached: false };
    try {
      const corpus = learningCorpusSchema.parse(row.data);
      if (this.packed !== corpus.data) {
        // Fixed output bound prevents a malformed compressed mirror from allocating arbitrarily.
        const bytes = inflateSync(fromBase64Url(corpus.data), {
          out: new Uint8Array(4 * 1024 * 1024),
        });
        const decoded: unknown = JSON.parse(utf8Decode(bytes, true));
        const words = z.array(learningWordSchema).max(20_000).parse(decoded);
        if (
          words.length !== corpus.count ||
          new Set(words.map((w) => w[0])).size !== words.length
        )
          throw new AppError("E_INTEGRITY", "词库内容不完整");
        this.words = words;
        this.packed = corpus.data;
      }
      return {
        words: this.words,
        progress,
        version: corpus.version,
        cached: true,
      };
    } catch {
      return {
        words: [],
        progress,
        version: 0,
        cached: true,
        error: "词库校验失败，请连接服务器重新同步",
      };
    }
  }
}
export function wordProgress(data: LearningData, id: string): LearningProgress {
  return data.progress.get(id) ?? emptyLearningProgress(id);
}
export function learningDay(at: number): number {
  return Math.floor((at + 8 * 60 * 60 * 1000) / 86400000);
}
export function learningStats(
  data: LearningData,
  now: number,
): {
  total: number;
  mastered: number;
  wrong: number;
  today: number;
  remaining: number;
  answers: number;
} {
  let mastered = 0,
    wrong = 0,
    today = 0,
    answers = 0;
  for (const word of data.words) {
    const c = learningCounts(wordProgress(data, word[0]));
    if (c.mastered) mastered++;
    if (c.wrong) wrong++;
    if (c.answered && learningDay(c.lastAt) === learningDay(now)) today++;
    answers += c.answered;
  }
  return {
    total: data.words.length,
    mastered,
    wrong,
    today,
    remaining: data.words.length - mastered,
    answers,
  };
}
