import { StateStore } from "../../../core/controller-state.ts";

/** One workbench section: a stable id, its list title and the roles that may open it. */
export interface WorkbenchSection {
  id: string;
  title: string;
  roles: readonly string[];
}

export const BUILT_IN_SECTIONS: readonly WorkbenchSection[] = [
  { id: "overview", title: "概览", roles: ["administrator"] },
  {
    id: "users",
    title: "用户",
    roles: [
      "root",
      "access_manager",
      "feature_manager",
      "community_manager",
      "advanced_community_manager",
    ],
  },
  { id: "invitations", title: "邀请", roles: ["root", "access_manager"] },
  { id: "devices", title: "设备", roles: ["root", "access_manager"] },
  {
    id: "groups",
    title: "群组",
    roles: ["root", "community_manager", "advanced_community_manager"],
  },
  {
    id: "announcements",
    title: "公告",
    roles: ["root", "advanced_community_manager"],
  },
  {
    id: "system",
    title: "系统",
    roles: ["root", "access_manager", "community_manager"],
  },
  { id: "incidents", title: "事件", roles: ["root", "operations"] },
  { id: "audit", title: "审计", roles: ["root"] },
  { id: "debug", title: "调试", roles: ["root"] },
];

/** Root may open everything; otherwise a section needs one of its roles. */
export function allowedSections(
  sections: readonly WorkbenchSection[],
  roles: readonly string[],
): WorkbenchSection[] {
  return sections.filter(
    (section) =>
      roles.includes("root") ||
      section.roles.some((role) => roles.includes(role)),
  );
}
/** The selected section when still allowed, otherwise the first allowed one. */
export function currentSection(
  allowed: readonly WorkbenchSection[],
  selected: string,
): WorkbenchSection | undefined {
  return allowed.find((section) => section.id === selected) ?? allowed[0];
}
export type WorkbenchContent = "forbidden" | "offline" | "section";
/** Admin data is online only; the debug pane stays reachable to switch forced-offline off. */
export function workbenchContent(
  current: WorkbenchSection | undefined,
  online: boolean,
): WorkbenchContent {
  return !current
    ? "forbidden"
    : !online && current.id !== "debug"
      ? "offline"
      : "section";
}

/** Which section the administrator selected; roles and connection come from the snapshot. */
export class WorkbenchController extends StateStore<{ selected: string }> {
  constructor() {
    super({ selected: "overview" });
  }
  select = (selected: string): void => this.patch({ selected });
}
