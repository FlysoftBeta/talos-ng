import { describe, expect, it } from "vitest";
import {
  applyLearningAnswer,
  emptyLearningProgress,
  nextLearningAnswer,
} from "@talos/contract";
import type { LearningData } from "./corpus.ts";
import { WORD_LIST_PAGE_SIZE, wordListModel } from "./word-list.ts";

const id = (i: number) => `00000000000000000000${String(i).padStart(6, "0")}`;
const words: LearningData["words"] = Array.from({ length: 21 }, (_, i) => [
  id(i),
  `word${String(i).padStart(2, "0")}`,
  `释义${i}`,
]);
function dataWith(kind: "wrong" | "mastered", count = 21): LearningData {
  const list = words.slice(0, count);
  return {
    cached: true,
    version: 1,
    words: list,
    progress: new Map(
      list.map((word) => [
        word[0],
        applyLearningAnswer(
          emptyLearningProgress(word[0]),
          nextLearningAnswer(
            emptyLearningProgress(word[0]),
            "00000000000000000000999999",
            kind,
            1,
          ),
        ),
      ]),
    ),
  };
}

describe.each(["wrong", "mastered"] as const)("%s word list paging", (kind) => {
  it("pages in tens, flags the ends and clamps after words disappear", () => {
    const data = dataWith(kind);
    const first = wordListModel(data, kind, 0);
    if (first.empty) throw new Error("expected rows");
    expect(first.rows.map((r) => r.title)).toEqual(
      words.slice(0, WORD_LIST_PAGE_SIZE).map((w) => w[1]),
    );
    expect([first.hasPrevious, first.hasNext, first.pageCount]).toEqual([
      false,
      true,
      3,
    ]);
    const last = wordListModel(data, kind, 2);
    if (last.empty) throw new Error("expected rows");
    expect(last.rows.map((r) => r.title)).toEqual(["word20"]);
    expect([last.hasPrevious, last.hasNext, last.indicator]).toEqual([
      true,
      false,
      "3 / 3",
    ]);
    // the viewer is on page 3 when only two words remain: clamp to the last page
    const shrunk = wordListModel(dataWith(kind, 2), kind, 2);
    if (shrunk.empty) throw new Error("expected rows");
    expect(shrunk.current).toBe(0);
    expect(shrunk.rows).toHaveLength(2);
    expect([shrunk.hasPrevious, shrunk.hasNext]).toEqual([false, false]);
  });
  it("reports an empty list when nothing qualifies", () => {
    const data: LearningData = {
      cached: true,
      version: 1,
      words,
      progress: new Map(),
    };
    expect(wordListModel(data, kind, 3).empty).toBe(true);
  });
  it("does not leak the other list: only the matching kind appears", () => {
    const other = kind === "wrong" ? "mastered" : "wrong";
    expect(wordListModel(dataWith(other), kind, 0).empty).toBe(true);
  });
});
