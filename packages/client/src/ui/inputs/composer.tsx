import type { ReactElement, ReactNode, TextareaHTMLAttributes } from "react";
import { useLayoutEffect, useRef } from "react";
import { Button } from "../actions/button.tsx";
import "./inputs.css";

const MAX_LINES = 5;
/**
 * One-row editor shared by chat and AI: tools on the left, a text area that grows to five
 * lines, the send button on the right, all inside one field. Callers own drafts and sending.
 */
export function Composer({
  actions,
  after,
  above,
  onSend,
  sendDisabled,
  sendLabel = "发送",
  ...editor
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  actions?: ReactNode;
  /** Chips under the field (attached images). */
  after?: ReactNode;
  /** A strip above the field (reply target, reason the composer cannot send). */
  above?: ReactNode;
  onSend: () => void;
  sendDisabled?: boolean;
  sendLabel?: string;
}): ReactElement {
  const area = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = area.current;
    if (!node) return;
    node.style.height = "auto";
    const line = parseFloat(getComputedStyle(node).lineHeight) || 20;
    node.style.height = `${Math.min(node.scrollHeight, line * MAX_LINES + 2)}px`;
  }, [editor.value]);
  return (
    <div className="composer">
      {above && <div className="composer-above">{above}</div>}
      <div className="composer-field">
        {actions && <div className="composer-tools">{actions}</div>}
        <textarea
          {...editor}
          ref={area}
          className="composer-input"
          aria-label={editor["aria-label"] ?? "消息"}
          rows={1}
          onKeyDown={(event) => {
            editor.onKeyDown?.(event);
            if (
              !event.defaultPrevented &&
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              onSend();
            }
          }}
        />
        <Button
          variant="primary"
          size="small"
          className="composer-send"
          disabled={sendDisabled}
          onClick={onSend}
        >
          {sendLabel}
        </Button>
      </div>
      {after && <div className="composer-chips">{after}</div>}
    </div>
  );
}
