import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { PaneBody, PaneHeader } from "../../../ui/layout/index.ts";
import { ListRow, StatePanel } from "../../../ui/feedback/index.ts";
import type { WordListModel } from "../model/word-list.ts";
import "./learning.css";
export function WordListView({
  title,
  model,
  onStartClear,
  onPage,
}: {
  /** The page name, shown while the list is empty. */
  title: string;
  model: WordListModel;
  onStartClear: () => void;
  onPage: (page: number) => void;
}): ReactElement {
  if (model.empty)
    return (
      <>
        <PaneHeader title={title} />
        <PaneBody>
          <StatePanel state="empty" title={model.title} hint={model.hint} />
        </PaneBody>
      </>
    );
  return (
    <>
      <PaneHeader
        title={model.title}
        actions={
          model.canClear ? (
            <Button variant="primary" onClick={onStartClear}>
              开始清错
            </Button>
          ) : undefined
        }
      />
      <PaneBody className="learn-words">
        <p className="learn-words-hint">{model.hint}</p>
        {model.rows.map((row) => (
          <ListRow
            key={row.id}
            title={row.title}
            hint={row.hint}
            meta={row.tag}
          />
        ))}
      </PaneBody>
      {model.pageCount > 1 && (
        <div className="pane-footer learn-pager">
          <span>{model.indicator}</span>
          <Button
            size="small"
            disabled={!model.hasPrevious}
            onClick={() => onPage(model.previousPage)}
          >
            上一页
          </Button>
          <Button
            size="small"
            disabled={!model.hasNext}
            onClick={() => onPage(model.nextPage)}
          >
            下一页
          </Button>
        </div>
      )}
    </>
  );
}
