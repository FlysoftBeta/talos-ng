import type { ReactElement, ReactNode, CSSProperties } from "react";
import { useState } from "react";
import { AppError } from "@talos/base";
import { tokens } from "./tokens.ts";
import type { ColorMode } from "./tokens.ts";
import { ToastHost } from "../feedback/toast.tsx";
import "./base.css";

const UNSAFE_CSS =
  /(?:^|[;{\s])(?:gap|row-gap|column-gap|inset|aspect-ratio|backdrop-filter)\s*:|\b(?:clamp|min|max)\s*\(|:(?:is|where)\s*\(/i;
/** The Chrome 70 CSS rule shared with `scripts/css-check.mjs` (which lints every stylesheet). */
export function assertSafeCss(css: string): void {
  if (UNSAFE_CSS.test(css))
    throw new AppError("E_INVALID", "样式不支持 Chrome 70");
}
const variables = {
  light: paletteVariables("light"),
  dark: paletteVariables("dark"),
};
function paletteVariables(mode: ColorMode): CSSProperties {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens.palettes[mode]))
    result[`--${key}`] = value;
  return result as CSSProperties;
}
/**
 * Root of every Talos surface: palette variables, colour scheme, input modality (a
 * `:focus-visible` substitute for Chrome 70) and the toast host.
 */
export function TalosProvider({
  mode = "light",
  className = "",
  children,
}: {
  mode?: ColorMode;
  className?: string;
  children: ReactNode;
}): ReactElement {
  const [keyboard, setKeyboard] = useState(true);
  return (
    <div
      className={`talos ${className}`}
      data-theme={mode}
      data-focus={keyboard ? "keyboard" : "pointer"}
      onKeyDownCapture={(event) => {
        if (!event.altKey && !event.ctrlKey && !event.metaKey)
          setKeyboard(true);
      }}
      onMouseDownCapture={() => setKeyboard(false)}
      onTouchStartCapture={() => setKeyboard(false)}
      style={variables[mode]}
    >
      <ToastHost>{children}</ToastHost>
    </div>
  );
}
