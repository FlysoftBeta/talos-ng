import type { ReactElement } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { Field } from "../../../ui/inputs/index.ts";
import { Sheet } from "../../../ui/overlays/index.ts";
import { Stack } from "../../../ui/layout/index.ts";
import type {
  CreditBatchController,
  CreditBatchState,
} from "../model/credit-batch.ts";

export function CreditBatchView({
  count,
  state,
  summary,
  canRun,
  actions,
}: {
  count: number;
  state: CreditBatchState;
  /** Results counted by the model once the batch has run. */
  summary:
    | {
        succeeded: number;
        failures: readonly { assignment: { user: string }; error?: string }[];
      }
    | undefined;
  canRun: boolean;
  actions: CreditBatchController;
}): ReactElement {
  const { busy, results } = state;
  return (
    <Sheet
      open
      title={`批量分配 AI 额度 · ${count} 位用户`}
      onClose={actions.close}
      footer={
        <>
          <Button onClick={actions.close}>取消</Button>
          <Button
            variant="contained"
            disabled={!canRun}
            onClick={() => void actions.run()}
          >
            {busy ? "正在分配…" : results ? "重试失败项" : "确认分配到所选用户"}
          </Button>
        </>
      }
    >
      <Stack>
        <p>
          每位用户分别获得以下充值和套餐。失败项可单独重试，已成功的分配不会重复。
        </p>
        <Field
          label="每人充值额度"
          type="number"
          min="0"
          value={state.amount}
          disabled={busy || !!results}
          onChange={(e) => actions.setAmount(e.target.value)}
        />
        <Field
          label="每人套餐天数"
          type="number"
          min="0"
          max="3650"
          value={state.days}
          disabled={busy || !!results}
          onChange={(e) => actions.setDays(e.target.value)}
        />
        <Field
          label="分配备注"
          value={state.note}
          maxLength={200}
          disabled={busy || !!results}
          onChange={(e) => actions.setNote(e.target.value)}
        />
        {summary && (
          <div role="status">
            成功 {summary.succeeded}，失败 {summary.failures.length}
            {summary.failures.map((r) => (
              <p key={r.assignment.user}>
                {r.assignment.user}：{r.error}
              </p>
            ))}
          </div>
        )}
      </Stack>
    </Sheet>
  );
}
