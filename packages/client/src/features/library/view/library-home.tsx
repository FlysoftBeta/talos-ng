import type { ReactElement } from "react";
import { EmptyPane } from "../../../ui/layout/index.ts";
import { StatePanel } from "../../../ui/feedback/index.ts";
import "./library.css";

export function LibraryHomeView(): ReactElement {
  return <EmptyPane icon="library" hint="选择一个书单或文档" />;
}
export function CollectionMissingView(): ReactElement {
  return <StatePanel state="forbidden" hint="书单已删除或访问权限已撤销" />;
}
