import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import {
  useClientSnapshot,
  useRepository,
  useRuntime,
} from "../../../platform/react/context.tsx";
import { decodeJobs, downloadLabel } from "../model/jobs.ts";
import { remainingSeconds } from "../model/cooldown.ts";
import {
  NetbooksController,
  canSearch,
  unavailableReason,
} from "../model/netbooks-controller.ts";
import {
  NetbooksDialogView,
  NetbooksEntryView,
} from "../view/netbooks-dialog.tsx";

export interface NetbookDestination {
  id: string;
  title: string;
}
function NetbooksDialog({
  destinations,
  onClose,
}: {
  destinations: NetbookDestination[];
  onClose: () => void;
}): ReactElement {
  const runtime = useRuntime();
  useClientSnapshot();
  const controller = useMemo(() => new NetbooksController(runtime), [runtime]);
  useEffect(() => () => controller.dispose(), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const jobs = decodeJobs(
    useRepository(runtime.repositories.get("tasks.jobs")!),
  );
  const { reason, forbidden } = unavailableReason(runtime);
  return (
    <NetbooksDialogView
      query={state.query}
      onQuery={(query) => controller.setQuery(query)}
      canSearch={canSearch(state, reason)}
      onSearch={() => void controller.search()}
      busy={state.busy}
      seconds={remainingSeconds(state.deadline, state.now)}
      reason={reason}
      forbidden={forbidden}
      destinations={destinations}
      collection={state.collection}
      onCollection={(id) => controller.setCollection(id)}
      error={state.error}
      books={state.books}
      downloading={state.downloading}
      submittedLabel={(book) =>
        state.submitted[book] === undefined
          ? undefined
          : downloadLabel(jobs, state.submitted[book]!)
      }
      onDownload={(book) => void controller.download(book)}
      notice={state.notice}
      onShowTasks={() => {
        onClose();
        controller.showTasks();
      }}
      onClose={onClose}
    />
  );
}
/** Library-toolbar entry. The destination booklists are supplied by the application. */
export function NetbooksEntry({
  destinations,
}: {
  destinations: NetbookDestination[];
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <NetbooksEntryView open={open} onOpen={() => setOpen(true)}>
      <NetbooksDialog
        destinations={destinations}
        onClose={() => setOpen(false)}
      />
    </NetbooksEntryView>
  );
}
