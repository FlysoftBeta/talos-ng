import type { ReactElement } from "react";
import { createElement } from "react";
import { glyphs } from "./glyphs.ts";
import type { IconName } from "./glyphs.ts";
export type { IconName } from "./glyphs.ts";
/** Inline SVG glyph; inherits colour. Sizes: 16 (inline), 20 (controls), 24+ (states). */
export function Icon({
  name,
  size = 20,
  className,
  spin = false,
}: {
  name: IconName;
  size?: number;
  className?: string;
  spin?: boolean;
}): ReactElement {
  return (
    <svg
      className={`icon${spin ? " icon-spin" : ""}${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={size <= 16 ? 2 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyphs[name].map(([tag, attrs], index) =>
        createElement(tag, { key: index, ...attrs }),
      )}
    </svg>
  );
}
