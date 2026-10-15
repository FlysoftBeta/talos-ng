import type { ReactElement } from "react";
import { useRuntime } from "../../../platform/react/context.tsx";
import { BillingController } from "../model/billing.ts";
import { BillingView } from "../view/billing.tsx";
import { useController } from "../../../platform/react/use-controller.ts";

export function BillingPanel(): ReactElement {
  const runtime = useRuntime(),
    [controller, state] = useController(() => new BillingController(runtime));
  return (
    <BillingView
      state={state}
      chart={controller.chart()}
      actions={controller}
    />
  );
}
export const aiAdminPanels = [
  {
    id: "billing",
    title: "AI 额度与统计",
    requiredRole: "feature_manager" as const,
    component: BillingPanel,
  },
];
