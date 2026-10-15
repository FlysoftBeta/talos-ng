import type {
  User,
  AuthorityAction,
  Feature,
  AdminRole,
} from "@talos/contract";
export interface AuthorityPolicy {
  can(
    actor: string | User,
    action: AuthorityAction,
    resource?: { id?: string; owner?: string; feature?: Feature },
  ): boolean;
}

export interface AuthorityAdmin extends AuthorityPolicy {
  actor(id: string): User | undefined;
  roots(): number;
  setAccess(
    user: string,
    patch: {
      roles?: readonly AdminRole[];
      features?: readonly Feature[];
    },
  ): void;
}
