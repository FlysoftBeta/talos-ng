import type { ReactElement } from "react";
import { EmptyPane } from "../../../ui/layout/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import type { missingCollection } from "../model/library-data.ts";
import "./library.css";

export function LibraryHomeView(): ReactElement {
  return <EmptyPane icon="library" hint="选择一个书单或文档" />;
}
export function CollectionMissingView(
  props: ReturnType<typeof missingCollection>,
): ReactElement {
  return <StatePanel {...props} />;
}
