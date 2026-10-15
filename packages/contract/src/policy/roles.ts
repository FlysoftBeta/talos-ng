import { z } from "zod";
export const ADMIN_ROLES = [
  "administrator",
  "root",
  "operations",
  "feature_manager",
  "operations_assistant",
  "access_manager",
  "community_manager",
  "advanced_community_manager",
] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];
export const adminRoleSchema = z.enum(ADMIN_ROLES);
export function roleDependencies(role: AdminRole): readonly AdminRole[] {
  if (role === "administrator") return [];
  return role === "advanced_community_manager"
    ? ["administrator", "community_manager"]
    : ["administrator"];
}
export function rolesWithDependencies(
  roles: readonly AdminRole[],
): readonly AdminRole[] {
  const selected = new Set<AdminRole>(roles);
  roles.forEach((role) =>
    roleDependencies(role).forEach((dependency) => selected.add(dependency)),
  );
  return ADMIN_ROLES.filter((role) => selected.has(role));
}
