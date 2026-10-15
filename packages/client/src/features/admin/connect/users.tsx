import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { downloadText } from "../adapters/browser-effects.ts";
import {
  bulkNeedsDuration,
  bulkReportCounts,
  bulkReportText,
} from "../model/bulk-users.ts";
import { durationInputProps } from "../model/duration.ts";
import { UsersController } from "../model/users.ts";
import { BulkReportDialog, BulkUsersSheet } from "../view/bulk-users.tsx";
import { UserEditorDialog } from "../view/user-editor.tsx";
import { UserRestrictionSheets } from "../view/user-restriction.tsx";
import { UsersView } from "../view/users.tsx";
import { CreditBatch } from "./credit-batch.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

export function UsersPanel(): ReactElement {
  const runtime = useRuntime();
  const [controller, state] = useController(() => new UsersController(runtime));
  const duration = durationInputProps(state.duration, controller.setDuration);
  return (
    <UsersView state={state} rows={controller.rows()} actions={controller}>
      {state.creditUsers && (
        <CreditBatch
          users={state.creditUsers}
          onClose={controller.closeCredit}
        />
      )}
      <BulkReportDialog
        report={state.report}
        counts={bulkReportCounts(state.report ?? [])}
        onClose={controller.closeReport}
        onExport={() =>
          downloadText("批量结果.txt", bulkReportText(state.report ?? []))
        }
      />
      <UserRestrictionSheets
        state={state}
        duration={duration}
        actions={controller}
      />
      <BulkUsersSheet
        state={state}
        duration={duration}
        needsDuration={bulkNeedsDuration(state.bulk)}
        canApply={controller.canApplyBulk()}
        actions={controller}
      />
      <UserEditorDialog
        state={state}
        canSave={controller.canSave()}
        actions={controller}
      />
    </UsersView>
  );
}
