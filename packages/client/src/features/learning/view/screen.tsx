import type { ReactElement, ReactNode } from "react";
import { Pane, PaneBody, PaneHeader } from "../../../ui/layout/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import "./learning.css";

/** The content pane of the learning area; each page renders its own header. */
export function ScreenView({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <Pane className="learn-page" data-testid="learning.page">
      {children}
    </Pane>
  );
}
export function ScreenStateView({
  title,
  state,
  hint,
}: {
  title: string;
  state: "forbidden" | "error" | "offline" | "loading";
  hint?: string;
}): ReactElement {
  return (
    <>
      <PaneHeader title={title} />
      <PaneBody>
        <StatePanel state={state} hint={hint} />
      </PaneBody>
    </>
  );
}
export function ForbiddenView({ reason }: { reason: string }): ReactElement {
  return <StatePanel state="forbidden" hint={reason} compact />;
}
