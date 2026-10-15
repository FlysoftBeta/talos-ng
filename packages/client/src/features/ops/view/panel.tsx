import type { ReactElement, ReactNode } from "react";
import { Button } from "../../../ui/actions/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import { Pane, PaneBody, PaneHeader, Stack } from "../../../ui/layout/index.ts";
import type { ActionHandlers, PanelFrame } from "../model/panel.ts";
import { ActionView } from "./action.tsx";
import "./ops.css";

/** Each online-only panel owns its aligned header and scrolling content. */
export function PanelView({
  frame,
  handlers,
  children,
}: {
  frame: PanelFrame;
  handlers: ActionHandlers;
  children: ReactNode;
}): ReactElement {
  return (
    <Pane className="ops-panel" data-testid="ops.panel">
      <PaneHeader
        title={frame.title}
        actions={
          frame.status !== "offline" && (
            <ActionView
              action={frame.refresh}
              handlers={handlers}
              variant="ghost"
            />
          )
        }
      />
      <PaneBody padded narrow>
        {frame.status === "offline" ? (
          <StatePanel state="offline" title="离线不可用" hint={frame.reason} />
        ) : frame.status === "error" ? (
          <StatePanel
            state="error"
            hint={frame.error}
            action={
              <Button onClick={() => void handlers.press("refresh")}>
                重试
              </Button>
            }
          />
        ) : frame.status === "loading" ? (
          <StatePanel state="loading" />
        ) : (
          <Stack className="ops-content" space={5}>
            <p className="ops-hint">{frame.hint}</p>
            {children}
          </Stack>
        )}
      </PaneBody>
    </Pane>
  );
}
