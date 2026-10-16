import type { Row } from "@talos/sync";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import type { CommunitySyncRead } from "./ports.ts";
import { publicConversation } from "./repo.ts";
import type { ConversationRecord, MemberRecord } from "./repo.ts";
interface Entry {
  rev: number;
  id: string;
  member?: MemberRecord;
  head?: Row;
}
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
  const memberRow = (
    row: MemberRecord,
    self: boolean,
    conversation: ConversationRecord | undefined,
  ): Row => {
    const deleted =
      !!row.deleted ||
      (!self && (!!row.hidden || !!conversation?.members_hidden));
    return {
      type: self ? "communitySelf" : "communityMember",
      id: self ? row.conversation : row.user,
      rev: row.rev,
      deleted,
      data: deleted ? null : service.publicMember(row),
    };
  };
  const member = (
    scope: string,
    id: string,
    self: boolean,
  ): Row | undefined => {
    const user = self ? scope.slice(3) : id;
    const conv = self ? id : scope.slice(5);
    const row = service.records.member(user, conv);
    return row
      ? memberRow(row, self, self ? undefined : service.records.get(conv))
      : undefined;
  };
  hub.registerProvider({
    match: (scope) => scope.startsWith("conv:"),
    access: (user, scope) => service.canAccess(user, scope.slice(5)),
    list: (user) => service.conversations(user).map((row) => `conv:${row.id}`),
    select: (scope, since, limit) => {
      const id = scope.slice(5);
      const record = service.records.get(id);
      // A page of member records is read directly (one indexed query) and only
      // the rows of this page are materialised; the conversation row joins it.
      const members = service.records
        .membersAfter(id, since, limit)
        .map((row): Entry => ({ rev: row.rev, id: row.user, member: row }));
      const head = conversation(id);
      return [
        ...(head && head.rev > since ? [{ rev: head.rev, id, head }] : []),
        ...members,
      ]
        .sort(
          (a, b) => a.rev - b.rev || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        )
        .slice(0, limit)
        .map((entry) =>
          entry.member ? memberRow(entry.member, false, record) : entry.head!,
        );
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
        .map((row) => memberRow(row, true, undefined)),
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
