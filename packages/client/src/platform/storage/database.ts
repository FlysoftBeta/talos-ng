import type { Database, DbOptions, Migration } from "@talos/store";
import { createFileStores, openDb } from "@talos/store";

/** Append forward-only migrations. Generic feature rows need no schema change. */
export const appMigrations: readonly Migration[] = [
  {
    version: 1,
    upgrade(tx) {
      const db = tx.db;
      db.createObjectStore("rows", { keyPath: ["scope", "type", "id"] });
      db.createObjectStore("scopes", { keyPath: "scope" });
      db.createObjectStore("outbox");
      db.createObjectStore("session");
      db.createObjectStore("nav");
      db.createObjectStore("kv");
    },
  },
  {
    version: 2,
    upgrade(tx) {
      createFileStores(tx);
    },
  },
  {
    version: 3,
    upgrade(tx) {
      const entries = tx.db.createObjectStore("cache_entries", {
        keyPath: "key",
      });
      const cursor = tx.objectStore("kv").openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        const key = String(item.key);
        if (
          /^feature:[^:]+:(conv:[^:]+:body:|library:[^:]+:manifest)/.test(key)
        )
          entries.put({
            key,
            bytes: JSON.stringify(item.value)?.length * 2 || 0,
            accessed: 0,
          });
        item.continue();
      };
    },
  },
  {
    version: 4,
    upgrade(tx) {
      // Old media mirrors duplicated shared tracks into personal scopes. Rebuild
      // those projections so a pre-upgrade favourite cannot preserve a lost grant.
      const rows = tx.objectStore("rows").openCursor();
      rows.onsuccess = () => {
        const row = rows.result;
        if (!row) return;
        if (
          ["mediaTrack", "mediaPlaylist", "mediaUserState"].includes(
            row.value.type,
          )
        )
          row.delete();
        row.continue();
      };
      const scopes = tx.objectStore("scopes").openCursor();
      scopes.onsuccess = () => {
        const row = scopes.result;
        if (!row) return;
        if (/^(me|coll):/.test(row.value.scope))
          row.update({ ...row.value, cursor: 0 });
        row.continue();
      };
      const owners = tx.objectStore("file_owners").openCursor();
      owners.onsuccess = () => {
        const row = owners.result;
        if (!row) return;
        if (/^[^:]+:media:/.test(row.value.owner)) row.delete();
        row.continue();
      };
    },
  },
];
export function openAppDb(
  options: Partial<Omit<DbOptions, "schema">> = {},
): Promise<Database> {
  return openDb({
    ...options,
    name: options.name ?? "talos-app",
    schema: appMigrations,
  });
}
