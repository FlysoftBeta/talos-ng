/** Panel identities and the roles that may use them; views and connect files register against this. */
export interface OpsPanelInfo {
  id: "update" | "backup" | "https" | "host" | "office";
  title: string;
  requiredRole: "root" | "administrator";
}
export const opsPanelInfo: readonly OpsPanelInfo[] = [
  { id: "update", title: "更新", requiredRole: "root" },
  { id: "backup", title: "备份", requiredRole: "administrator" },
  { id: "https", title: "HTTPS", requiredRole: "administrator" },
  { id: "host", title: "主机工具", requiredRole: "root" },
  { id: "office", title: "已打开的文档", requiredRole: "administrator" },
];
