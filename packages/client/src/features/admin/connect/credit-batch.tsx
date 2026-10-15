import { useMemo } from "react";
import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { CreditBatchController, batchSummary } from "../model/credit-batch.ts";
import { CreditBatchView } from "../view/credit-batch.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

export function CreditBatch({
  users,
  onClose,
}: {
  users: readonly string[];
  onClose: () => void;
}): ReactElement {
  const runtime = useRuntime();
  const [controller, state] = useController(
    () => new CreditBatchController(runtime, users, onClose),
  );
  const summary = useMemo(
    () => (state.results ? batchSummary(state.results) : undefined),
    [state.results],
  );
  return (
    <CreditBatchView
      count={users.length}
      state={state}
      summary={summary}
      canRun={controller.canRun()}
      actions={controller}
    />
  );
}
