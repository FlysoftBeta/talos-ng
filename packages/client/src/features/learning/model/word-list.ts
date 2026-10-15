import { learningCounts } from "@talos/contract";
import { wordProgress } from "./corpus.ts";
import type { LearningData } from "./corpus.ts";
import { pageTitles } from "./pages.ts";
import type { WordListKind } from "./pages.ts";

export const WORD_LIST_PAGE_SIZE = 10;

export interface WordListRow {
  id: string;
  title: string;
  hint: string;
  tag: string;
}

export type WordListModel =
  | { empty: true; title: string; hint: string }
  | {
      empty: false;
      title: string;
      hint: string;
      /** Whether the "start clearing wrong words" action belongs in the header. */
      canClear: boolean;
      rows: WordListRow[];
      /** The clamped, zero-based page actually shown. */
      current: number;
      pageCount: number;
      indicator: string;
      hasPrevious: boolean;
      hasNext: boolean;
      previousPage: number;
      nextPage: number;
    };

/** One page of the wrong/mastered list; `page` is clamped when words disappear. */
export function wordListModel(
  data: LearningData,
  kind: WordListKind,
  page: number,
): WordListModel {
  const words = data.words
    .map((word) => ({
      word,
      counts: learningCounts(wordProgress(data, word[0])),
    }))
    .filter((row) =>
      kind === "wrong" ? row.counts.wrong > 0 : row.counts.mastered,
    )
    .sort((a, b) =>
      kind === "wrong"
        ? b.counts.wrong - a.counts.wrong || a.word[1].localeCompare(b.word[1])
        : b.counts.lastAt - a.counts.lastAt ||
          a.word[1].localeCompare(b.word[1]),
    );
  if (!words.length)
    return {
      empty: true,
      title: kind === "wrong" ? "没有待巩固的单词" : "还没有已掌握的单词",
      hint:
        kind === "wrong"
          ? "保持练习，让记忆更牢固。"
          : "正确作答累积两次，或主动标记掌握。",
    };
  const pageCount = Math.ceil(words.length / WORD_LIST_PAGE_SIZE);
  const current = Math.min(page, Math.max(0, pageCount - 1));
  return {
    empty: false,
    title: `${pageTitles[kind]} · ${words.length} 词`,
    hint:
      kind === "wrong"
        ? "每答对一次，清除一次已观察到的错误。"
        : "掌握计数达到 2，并且没有未清除的错误。",
    canClear: kind === "wrong",
    rows: words
      .slice(
        current * WORD_LIST_PAGE_SIZE,
        current * WORD_LIST_PAGE_SIZE + WORD_LIST_PAGE_SIZE,
      )
      .map(({ word, counts }) => ({
        id: word[0],
        title: word[1],
        hint: word[2],
        tag:
          kind === "wrong" ? `错误 ${counts.wrong}` : `掌握 ${counts.learned}`,
      })),
    current,
    pageCount,
    indicator: `${current + 1} / ${pageCount}`,
    hasPrevious: current > 0,
    previousPage: current - 1,
    nextPage: current + 1,
    hasNext: (current + 1) * WORD_LIST_PAGE_SIZE < words.length,
  };
}
