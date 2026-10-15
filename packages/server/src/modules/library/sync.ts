import type { Row } from "@talos/sync";
import type { SyncHub } from "../../kernel/sync/sync-hub.ts";
import type { LibraryAccess } from "./access.ts";
import type { LibraryService } from "./service.ts";
export function registerLibrarySync(
  hub: SyncHub,
  service: LibraryService,
  access: LibraryAccess,
): void {
  const repo = service.repo;
  const personal = (user: string): Row[] => [
    ...repo
      .docs()
      .filter((row) => row.owner === user)
      .map((row) => repo.row("libraryDoc", row)),
    ...repo
      .collections()
      .filter((row) => row.owner === user)
      .map((row) => repo.row("libraryCollection", row)),
    ...repo.states(user).map((row) => repo.row("libraryState", row)),
  ];
  const collection = (id: string): Row[] => {
    const row = repo.collection(id);
    if (!row) return [];
    return [
      repo.row("libraryCollection", row),
      ...repo.items(id).map((item) => {
        const doc = repo.doc(item.id);
        if (item.deleted || !doc || doc.deleted)
          return {
            type: "libraryDoc",
            id: item.id,
            rev: Math.max(item.rev, doc?.rev ?? 0),
            deleted: true,
            data: null,
          };
        return {
          ...repo.row("libraryDoc", doc),
          rev: Math.max(item.rev, doc.rev),
        };
      }),
    ];
  };
  const select = (rows: Row[], since: number, limit: number) =>
    rows
      .filter((row) => row.rev > since)
      .sort((a, b) => a.rev - b.rev || a.id.localeCompare(b.id))
      .slice(0, limit);
  hub.registerProvider({
    match: (scope) => scope.startsWith("me:"),
    access: (user, scope) => scope === `me:${user}`,
    list: (user) => [`me:${user}`],
    select: (scope, since, limit) =>
      select(personal(scope.slice(3)), since, limit),
  });
  hub.registerProvider({
    match: (scope) =>
      scope.startsWith("coll:") && !!repo.collection(scope.slice(5)),
    access: (user, scope) => access.collection(user, scope.slice(5)),
    list: (user) =>
      repo
        .collections()
        .filter((row) => access.collection(user, row.id))
        .map((row) => `coll:${row.id}`),
    select: (scope, since, limit) =>
      select(collection(scope.slice(5)), since, limit),
  });
  for (const type of ["libraryDoc", "libraryCollection", "libraryState"]) {
    hub.registerEntity(type, {
      serialize: (row) => row,
      read: (scope, id) => {
        const rows = scope.startsWith("me:")
          ? personal(scope.slice(3))
          : collection(scope.slice(5));
        const row = rows.find((row) => row.type === type && row.id === id);
        if (row) return row;
        if (scope.startsWith("coll:") && type === "libraryDoc") {
          const coll = repo.collection(scope.slice(5));
          if (coll)
            return { type, id, rev: coll.rev, deleted: true, data: null };
        }
        return undefined;
      },
    });
  }
}
