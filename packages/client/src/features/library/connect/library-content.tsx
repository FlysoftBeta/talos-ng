import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import type { LibraryCollection } from "@talos/contract";
import { contract } from "@talos/contract";
import {
  useCan,
  useClientSnapshot,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { GrantSheet } from "../../sharing/index.ts";
import {
  CollectionEditor,
  collectionSharing,
  moveDocument,
  withoutDocument,
} from "../model/collections.ts";
import {
  collectionLevel,
  collectionOfPage,
  writableCollections,
} from "../model/library-data.ts";
import { CollectionView } from "../view/collection-view.tsx";
import {
  CollectionMissingView,
  LibraryHomeView,
} from "../view/library-home.tsx";
import { useLibrary } from "./use-library.ts";
import { documentRowExtras } from "./row-extras.ts";

function ConnectedCollection({
  collection,
}: {
  collection: LibraryCollection;
}): ReactElement {
  const runtime = useRuntime(),
    state = useClientSnapshot(),
    data = useLibrary(),
    can = useCan(contract.library.collection.items);
  const level = collectionLevel(data, collection, state.user!.id);
  const [sharing, setSharing] = useState(false),
    [deleting, setDeleting] = useState(false),
    [transferring, setTransferring] = useState(""),
    [canTransfer, setCanTransfer] = useState(
      collection.owner === state.user!.id,
    ),
    [selected, setSelected] = useState("");
  const editor = useMemo(
    () => new CollectionEditor(runtime, collection.id),
    [runtime, collection.id],
  );
  const { busy, error } = useSyncExternalStore(
    editor.subscribe,
    editor.getState,
  );
  const adapter = useMemo(
    () => collectionSharing(runtime, collection.id),
    [runtime, collection.id],
  );
  const permissionRevision = data.rows.reduce(
    (rev, row) =>
      row.type === "libraryCollection" && row.id === collection.id
        ? Math.max(rev, row.rev)
        : rev,
    0,
  );
  useEffect(() => {
    let active = true;
    setCanTransfer(collection.owner === state.user!.id);
    if (!collection.builtin && collection.owner !== state.user!.id)
      void adapter
        .list()
        .then((value) => {
          if (active) setCanTransfer(value.canShare);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [
    adapter,
    collection.id,
    collection.owner,
    collection.builtin,
    permissionRevision,
    state.status.connection,
    state.user!.id,
  ]);
  const reason = can.ok ? undefined : can.reason;
  const save = (docs: string[]) => editor.save(docs);
  return (
    <CollectionView
      title={collection.title}
      items={collection.docs.map((id) => {
        const doc = data.docs.find((d) => d.id === id);
        return doc
          ? {
              id,
              title: doc.title,
              ...documentRowExtras(data, state.status.downloads, doc),
            }
          : { id, title: undefined };
      })}
      canWrite={level !== "read"}
      canDelete={!collection.builtin && level === "own"}
      canShare={!collection.builtin}
      canTransfer={canTransfer}
      busy={busy}
      error={error}
      unavailableReason={reason}
      onBack={() => runtime.dispatch({ type: "back" })}
      onOpenDocument={(id) => runtime.dispatch({ type: "openDocument", id })}
      onMove={(index, direction) =>
        void save(moveDocument(collection.docs, index, direction))
      }
      onRemove={(id) => void save(withoutDocument(collection.docs, id))}
      transferring={transferring}
      onTransfer={setTransferring}
      onCloseTransfer={() => {
        setTransferring("");
        setSelected("");
      }}
      destinations={writableCollections(data, state.user!.id).filter(
        (target) => target.id !== collection.id,
      )}
      selected={selected}
      onSelect={setSelected}
      onConfirmTransfer={() =>
        void editor.transfer(transferring, selected).then((ok) => {
          if (ok) {
            setTransferring("");
            setSelected("");
          }
        })
      }
      onShare={() => setSharing(true)}
      shareSheet={
        sharing && (
          <GrantSheet
            title={collection.title}
            adapter={adapter}
            reason={reason}
            onClose={() => setSharing(false)}
          />
        )
      }
      deleting={deleting}
      onDelete={() => setDeleting(true)}
      onCloseDelete={() => setDeleting(false)}
      onConfirmDelete={() =>
        void editor.remove().then((ok) => {
          if (!ok) setDeleting(false);
        })
      }
    />
  );
}
export function LibraryContent({
  renderDocument,
}: {
  /** Application-supplied reader slot. */
  renderDocument: (id: string) => ReactNode;
}): ReactElement {
  const state = useClientSnapshot(),
    data = useLibrary(),
    stack = state.nav.areas.library.stack,
    page = stack[stack.length - 1]!;
  if (page.kind === "document") return <>{renderDocument(page.id)}</>;
  const id = collectionOfPage(page);
  if (id !== undefined) {
    const collection = data.collections.find((c) => c.id === id);
    return collection ? (
      <ConnectedCollection key={collection.id} collection={collection} />
    ) : (
      <CollectionMissingView />
    );
  }
  return <LibraryHomeView />;
}
