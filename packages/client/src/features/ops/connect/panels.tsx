import type { ComponentType } from "react";
import { opsPanelInfo } from "../model/panels.ts";
import type { OpsPanelInfo } from "../model/panels.ts";
import { BackupPanel } from "./backup.tsx";
import { HostPanel } from "./host.tsx";
import { HttpsPanel } from "./https.tsx";
import { OfficePanel } from "./office.tsx";
import { UpdatePanel } from "./update.tsx";

export interface OpsPanel extends OpsPanelInfo {
  component: ComponentType;
}
const components: Record<OpsPanelInfo["id"], ComponentType> = {
  update: UpdatePanel,
  backup: BackupPanel,
  https: HttpsPanel,
  host: HostPanel,
  office: OfficePanel,
};
export const opsPanels: readonly OpsPanel[] = opsPanelInfo.map((info) => ({
  ...info,
  component: components[info.id],
}));
