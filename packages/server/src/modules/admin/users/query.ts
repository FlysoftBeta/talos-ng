import type { AdminUser } from "@talos/contract";
import type {
  IdentityAdminDirectory,
  IdentityAdminUser,
} from "../../identity/ports.ts";
import type { ChatAdmin } from "../../chat/ports.ts";
export class AdminUsersQuery {
  constructor(
    private readonly identity: IdentityAdminDirectory,
    private readonly chat: ChatAdmin["adminQueries"],
  ) {}
  user(id: string): AdminUser | undefined {
    const user = this.identity.user(id);
    return user ? this.withMutes([user])[0] : undefined;
  }
  users(
    query: string,
    offset: number,
    limit: number,
    sort: "handle" | "created" | "name" = "handle",
  ): { items: AdminUser[]; total: number } {
    const page = this.identity.users(query, offset, limit, sort);
    return {
      items: this.withMutes(page.items),
      total: page.total,
    };
  }
  private withMutes(users: IdentityAdminUser[]): AdminUser[] {
    const mutes = this.chat.mutes(users.map((user) => user.id));
    return users.map((user) => ({
      ...user,
      mutedUntil: mutes.get(user.id) ?? 0,
    }));
  }
}
