import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { contract } from "@talos/contract";
import {
  useCan,
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { canCreateCollection, createCollection } from "../model/collections.ts";
import {
  collectionPageId,
  builtinRows,
  collectionRows,
  documentRows,
  emptyShelf,
  groupChoices,
} from "../model/library-data.ts";
import type { LibraryTab } from "../model/library-data.ts";
import {
  CreateCollectionDialog,
  LibraryListView,
} from "../view/library-list.tsx";
import { ImportDialog } from "./import-dialog.tsx";
import { useLibrary } from "./use-library.ts";
import { documentRowExtras } from "./row-extras.ts";

export function LibraryList({
  toolbarExtra,
}: {
  /** Application-supplied toolbar entry (network books). */
  toolbarExtra?: ReactNode;
}): ReactElement {
  const runtime = useRuntime(),
    state = useClientSnapshot(),
    data = useLibrary(),
    can = useCan(contract.library.doc.importText);
  const [tab, setTab] = useState<LibraryTab>("recent"),
    [importing, setImporting] = useState(false),
    [creating, setCreating] = useState(false),
    [title, setTitle] = useState(""),
    [group, setGroup] = useState(""),
    [error, setError] = useState("");
  const stack = state.nav.areas.library.stack,
    active = stack[stack.length - 1];
  return (
    <LibraryListView
      toolbarExtra={toolbarExtra}
      unavailableReason={can.ok ? undefined : can.reason}
      onImport={() => setImporting(true)}
      tab={tab}
      onTab={(value) => setTab(value as LibraryTab)}
      groups={groupChoices(data)}
      group={group}
      onGroup={setGroup}
      onCreate={() => setCreating(true)}
      collections={collectionRows(data, group, active)}
      builtins={builtinRows(data, active)}
      documents={documentRows(data, active).map((row) => {
        const doc = data.docs.find((d) => d.id === row.id);
        return doc
          ? {
              ...row,
              ...documentRowExtras(data, state.status.downloads, doc),
            }
          : row;
      })}
      emptyShelf={emptyShelf(state.status.connection)}
      onOpenCollection={(id) =>
        runtime.dispatch({
          type: "pushPage",
          area: "library",
          page: { kind: "page", id: collectionPageId(id) },
        })
      }
      onOpenDocument={(id) => runtime.dispatch({ type: "openDocument", id })}
    >
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {creating && (
        <CreateCollectionDialog
          title={title}
          onTitle={setTitle}
          error={error}
          canCreate={canCreateCollection(title)}
          onCreate={() => {
            void createCollection(runtime, { title, group }).then((result) => {
              if (result.error) setError(result.error);
              else {
                setCreating(false);
                setTitle("");
              }
            });
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </LibraryListView>
  );
}
