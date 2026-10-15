import { AppError } from "@talos/base";
import type { Db } from "../../kernel/persistence/db.ts";
import type { IdentityPurgePort } from "../../kernel/persistence/user-purge.ts";
import type { DirectoryRepo } from "./directory/repo.ts";
import { IdentityPurgeRepo } from "./purge-repo.ts";
export function identityPurge(
  db: Db,
  directory: DirectoryRepo,
  revoke: (user: string) => void,
): IdentityPurgePort {
  const repo = new IdentityPurgeRepo(db);
  return {
    owner: "identity",
    exists: (user) => !!directory.user(user),
    assertPurgeAllowed(user) {
      const record = directory.user(user);
      if (
        record &&
        directory.publicUser(record).roles.includes("root") &&
        !directory
          .activeUserIds()
          .some(
            (id) =>
              id !== user &&
              directory.publicUser(directory.user(id)!).roles.includes("root"),
          )
      )
        throw new AppError("E_CONFLICT", "不能清除最后一位根管理员");
    },
    prepare(user, tx) {
      repo.prepare(user, tx.rev);
      tx.changed(`me:${user}`, "profile", user);
      tx.afterCommit(() => revoke(user));
    },
    purgeUser(user, tx) {
      repo.remove(user);
      tx.changed(`me:${user}`, "profile", user);
    },
  };
}
