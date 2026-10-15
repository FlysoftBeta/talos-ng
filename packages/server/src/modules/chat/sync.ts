import type { Row } from "@talos/sync";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import type { ChatSyncRead } from "./ports.ts";
export function registerChatSync(service: ChatSyncRead, hub: SyncHub): void {
  const { repo, community, identity } = service;
  hub.registerProvider({
    match: (scope) => scope.startsWith("conv:"),
    access: (user, scope) => community.canAccess(user, scope.slice(5)),
    list: (user) =>
      community.conversations(user).map((conv) => `conv:${conv.id}`),
    select: (scope, since, limit) =>
      repo.postRows(scope.slice(5), since, limit),
  });
  hub.registerEntity("post", {
    windowed: true,
    serialize: (row) => row,
    read: (scope, id) => {
      const post = repo.post(id);
      return post && scope === `conv:${post.conversation}`
        ? repo.postRow(post)
        : undefined;
    },
  });
  hub.registerProvider({
    match: (scope) => scope.startsWith("me:"),
    access: (user, scope) => scope === `me:${user}` && identity.active(user),
    list: (user) => (identity.active(user) ? [`me:${user}`] : []),
    select: (scope, since, limit) => {
      const user = scope.slice(3),
        ack = repo.ack(user);
      const rows: Row[] = [
        ...repo.stateRows(user, since, limit),
        ...(ack && ack.rev > since ? [ack] : []),
      ];
      return rows
        .sort((a, b) => a.rev - b.rev || a.id.localeCompare(b.id))
        .slice(0, limit);
    },
  });
  hub.registerEntity("chatState", {
    serialize: (row) => row,
    read: (scope, id) => repo.stateRow(scope.slice(3), id),
  });
  hub.registerEntity("announcementAck", {
    serialize: (row) => row,
    read: (scope) => repo.ack(scope.slice(3)),
  });
  hub.registerProvider({
    match: (scope) => scope === "sys",
    access: (user) => identity.active(user),
    list: (user) => (identity.active(user) ? ["sys"] : []),
    select: (_scope, since) => {
      const row = repo.announcementRow();
      return row && row.rev > since ? [row] : [];
    },
  });
  hub.registerEntity("announcement", {
    serialize: (row) => row,
    read: () => repo.announcementRow(),
  });
}
