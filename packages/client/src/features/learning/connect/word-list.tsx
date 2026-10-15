import { useState } from "react";
import type { ReactElement } from "react";
import type { WordListKind } from "../model/pages.ts";
import { wordListModel } from "../model/word-list.ts";
import { WordListView } from "../view/word-list.tsx";
import { useLearning } from "./provider.tsx";
export function WordList({
  kind,
  title,
}: {
  kind: WordListKind;
  title: string;
}): ReactElement {
  const { data, controller } = useLearning();
  const [page, setPage] = useState(0);
  return (
    <WordListView
      title={title}
      model={wordListModel(data, kind, page)}
      onStartClear={() => controller.start("clear")}
      onPage={setPage}
    />
  );
}
