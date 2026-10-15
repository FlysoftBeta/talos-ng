import type { ReactElement } from "react";
import { Segmented } from "../../../ui/navigation/index.ts";
import { TRI_OPTIONS, triLabels } from "../model/bulk-users.ts";
import type { Tri } from "../model/bulk-users.ts";
export function TriState({
  value,
  onChange,
}: {
  value: Tri;
  onChange: (value: Tri) => void;
}): ReactElement {
  return (
    <Segmented
      label="变更方式"
      value={value}
      options={TRI_OPTIONS.map((option) => ({
        value: option,
        label: triLabels[option],
      }))}
      onChange={onChange}
    />
  );
}
