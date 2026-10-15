import type { Row } from "@talos/sync";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import type { CommunitySyncRead } from "./ports.ts";
import { publicConversation } from "./repo.ts";
/** Hidden memberships are tombstones in the shared scope; the owner keeps a private row. */
export function registerCommunitySync(
  service: CommunitySyncRead,
  hub: SyncHub,
): void {
  const conversation = (id: string): Row | undefined => {
    const row = service.records.get(id);
    return row
      ? {
          type: "communityConversation",
          id,
          rev: row.rev,
          deleted: !!row.deleted,
          data: row.deleted ? null : publicConversation(row),
        }
      : undefined;
  };
  const member = (
    scope: string,
    id: string,
    self: boolean,
  ): Row | undefined => {
    const user = self ? scope.slice(3) : id;
    const conv = self ? id : scope.slice(5);
    const row = service.records.member(user, conv);
    if (!row) return undefined;
    const deleted =
      !!row.deleted ||
      (!self && (!!row.hidden || !!service.records.get(conv)?.members_hidden));
    return {
      type: self ? "communitySelf" : "communityMember",
      id,
      rev: row.rev,
      deleted,
      data: deleted ? null : service.publicMember(row),
    };
  };
  hub.registerProvider({
    match: (scope) => scope.startsWith("conv:"),
    access: (user, scope) => service.canAccess(user, scope.slice(5)),
    list: (user) => service.conversations(user).map((row) => `conv:${row.id}`),
    select: (scope, since, limit) => {
      const id = scope.slice(5);
      const rows = [
        conversation(id),
        ...service.records
          .members(id)
          .map((row) => member(scope, row.user, false)),
      ].filter((row): row is Row => !!row && row.rev > since);
      return rows
        .sort((a, b) => a.rev - b.rev || a.id.localeCompare(b.id))
        .slice(0, limit);
    },
  });
  hub.registerProvider({
    match: (scope) => scope.startsWith("me:"),
    access: (user, scope) => scope === `me:${user}` && !!service.user(user),
    list: (user) => (service.user(user) ? [`me:${user}`] : []),
    select: (scope, since, limit) =>
      service.records
        .memberships(scope.slice(3))
        .filter((row) => row.rev > since)
        .slice(0, limit)
        .map((row) => member(scope, row.conversation, true)!),
  });
  hub.registerEntity("communityConversation", {
    serialize: (row) => row,
    read: (_scope, id) => conversation(id),
  });
  hub.registerEntity("communityMember", {
    serialize: (row) => row,
    read: (scope, id) => member(scope, id, false),
  });
  hub.registerEntity("communitySelf", {
    serialize: (row) => row,
    read: (scope, id) => member(scope, id, true),
  });
}
