import type { AdminAction } from "../modules/admin/index.ts";
import type { OpsAction } from "../modules/ops.ts";

/** Aggregate of every domain action plus the authority-owned ones. */
export type AuthorityAction =
  | OpsAction
  | AdminAction
  | "admin.enter"
  | "identity.invitation.create"
  | "authority.roles.set"
  | "authority.features.set"
  | "resource.read"
  | "resource.write"
  | "resource.own"
  | "feature.use";
