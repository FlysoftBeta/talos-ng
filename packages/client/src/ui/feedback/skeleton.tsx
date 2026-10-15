import type { ReactElement } from "react";
export function Skeleton({
  width = "100%",
  height = 14,
}: {
  width?: number | string;
  height?: number;
}): ReactElement {
  return (
    <span
      className="skeleton"
      role="status"
      aria-label="加载中"
      style={{ width, height }}
    />
  );
}
