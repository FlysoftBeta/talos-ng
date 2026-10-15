import type { ReactElement } from "react";
import { Icon } from "../../../ui/icon/index.ts";
export function NumPad({
  onKey,
  disabled,
}: {
  onKey: (key: string) => void;
  disabled?: boolean;
}): ReactElement {
  return (
    <div
      className="num-pad"
      data-testid="auth.numpad"
      role="group"
      aria-label="数字键盘"
    >
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "清除", "0", "退格"].map(
        (key) => (
          <button
            type="button"
            key={key}
            disabled={disabled}
            aria-label={key}
            className={/\d/.test(key) ? "is-digit" : "is-action"}
            onClick={() => onKey(key)}
          >
            {key === "退格" ? <Icon name="backspace" size={22} /> : key}
          </button>
        ),
      )}
    </div>
  );
}
