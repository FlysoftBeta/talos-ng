import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { contract, emptyLibraryState } from "@talos/contract";
import {
  useCan,
  useClientSnapshot,
  useGate,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { documentReadPort, useLibrary } from "../../library/index.ts";
import { documentVisibility } from "../adapters/page-visibility.ts";
import {
  ReadingSession,
  readerDetails,
  retentionChoice,
  retentionStatus,
} from "../model/reading-session.ts";
import type { ReaderInput, ReaderPort } from "../model/reading-session.ts";
import { ReaderMissingView, ReaderScreenView } from "../view/reader-screen.tsx";

export function ReaderScreen({ id }: { id: string }): ReactElement {
  const runtime = useRuntime(),
    snapshot = useClientSnapshot(),
    data = useLibrary(),
    doc = data.docs.find((d) => d.id === id),
    state = data.states.get(id) ?? emptyLibraryState(id),
    canDelete = useCan(contract.library.doc.delete),
    canOpen = useCan(contract.library.doc.open),
    readGate = useGate(
      doc?.kind === "paged" ? "ebook_reader" : "article_reader",
    ),
    offline = useGate("offline");
  const input: ReaderInput = {
    doc,
    state,
    readable: readGate.ok,
    canOpen: canOpen.ok,
    device: snapshot.device,
    foreground: snapshot.gate === "app" && !snapshot.concealed,
    downloads: snapshot.status.downloads,
  };
  const port = useMemo<ReaderPort>(
    () => ({
      ...documentReadPort(runtime),
      fetchBody: runtime.fetchBody,
      getLocal: runtime.getLocal,
      setLocal: runtime.setLocal,
      hasFile: runtime.hasFile,
      operation: runtime.operation,
      time: runtime.time,
      delay: runtime.delay,
      clearDelay: runtime.clearDelay,
      dispatch: runtime.dispatch,
      navigationGuards: runtime.navigationGuards,
    }),
    [runtime],
  );
  const [session] = useState(
    () => new ReadingSession(id, port, documentVisibility, input),
  );
  const reading = useSyncExternalStore(session.subscribe, session.getState);
  useEffect(() => {
    session.start();
    return () => session.dispose();
  }, [session]);
  useEffect(() => session.update(input));
  const [details, setDetails] = useState(false),
    [retention, setRetention] = useState(false),
    [deleting, setDeleting] = useState(false),
    [zoom, setZoom] = useState("fit"),
    [policy, setPolicy] = useState(retentionChoice(data.retentions.get(id)));
  if (!doc) return <ReaderMissingView />;
  return (
    <ReaderScreenView
      title={doc.title}
      paged={doc.kind === "paged"}
      processing={doc.status === "processing"}
      favourite={!!state.favourite?.v}
      error={reading.error}
      errorOffline={!canOpen.ok}
      resources={reading.resources}
      initialPosition={session.initialPosition()}
      zoom={zoom}
      onZoom={setZoom}
      onBack={() => session.back()}
      onToggleFavourite={() => void session.toggleFavourite()}
      onShowTasks={() => session.showTasks()}
      onRetry={() => session.retry()}
      onPosition={(position) => session.positionChanged(position)}
      details={readerDetails(doc, state, snapshot.user)}
      detailsOpen={details}
      onShowDetails={() => setDetails(true)}
      onCloseDetails={() => setDetails(false)}
      deleteReason={canDelete.ok ? undefined : canDelete.reason}
      onAskDelete={() => setDeleting(true)}
      deleting={deleting}
      onCloseDelete={() => setDeleting(false)}
      onConfirmDelete={() =>
        void session.deleteDocument().then((ok) => {
          if (!ok) {
            setDeleting(false);
            setDetails(false);
          }
        })
      }
      retentionOpen={retention}
      onShowRetention={() => {
        setPolicy(retentionChoice(data.retentions.get(id)));
        setRetention(true);
      }}
      onCloseRetention={() => setRetention(false)}
      policy={policy}
      onPolicy={setPolicy}
      retentionStatus={retentionStatus(
        reading.retained,
        snapshot.status.downloads,
        id,
      )}
      retentionReason={offline.ok ? undefined : offline.reason}
      onSaveRetention={() =>
        void session.saveRetention(policy).then((ok) => {
          if (ok) setRetention(false);
        })
      }
    />
  );
}
