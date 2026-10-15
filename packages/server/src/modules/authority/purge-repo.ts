import type { Db } from "../../kernel/persistence/db.ts";
import type { WriteContext } from "../../kernel/persistence/uow.ts";
import type { PurgePorts } from "./purge.ts";
export class AuthorityPurgeRepo {
  constructor(private readonly db: Db) {}
  purgeUser(user: string, ctx: WriteContext, domains: PurgePorts): void {
    const db = this.db;
    domains.revokePrincipal(user, ctx);

    db.run("DELETE FROM authority_grant_projections WHERE user_id=?", user);
    db.run("DELETE FROM authority_access WHERE user_id=?", user);
  }
}
