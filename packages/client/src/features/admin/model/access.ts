import { ADMIN_ROLES, FEATURES } from "@talos/contract";
import type { AdminRole, Feature } from "@talos/contract";

export const roleNames: Record<AdminRole, string> = {
  administrator: "管理员",
  root: "根管理员",
  operations: "运维",
  feature_manager: "功能管理员",
  operations_assistant: "运维助理",
  access_manager: "准入管理员",
  community_manager: "社区管理员",
  advanced_community_manager: "高级社区管理员",
};
export const featureNames: Record<Feature, string> = {
  offline: "离线使用",
  articles: "文章",
  article_reader: "文章阅读",
  ebook_reader: "电子书阅读",
  learning: "学习",
  article_download: "文章下载",
  ai: "AI",
  media: "音乐",
  post_images: "图片上传",
};

/** The signed-in account as far as administration rules need it. */
export interface AdminActor {
  id: string;
  roles: readonly string[];
}
/** Root holds every administrative responsibility; otherwise the named role is required. */
export function holdsRole(
  actor: AdminActor | undefined,
  role: AdminRole,
): boolean {
  return !!actor?.roles.includes("root") || !!actor?.roles.includes(role);
}
/** Debug controls are for the root administrator alone. */
export const isRoot = (actor: AdminActor | undefined): boolean =>
  !!actor?.roles.includes("root");

export const ROLE_OPTIONS = ADMIN_ROLES.map((role) => ({
  value: role,
  label: roleNames[role],
}));
export const FEATURE_OPTIONS = FEATURES.map((feature) => ({
  value: feature,
  label: featureNames[feature],
}));
