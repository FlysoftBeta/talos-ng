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
        // Forget the coverage too, so those scopes sync again from zero.
        if (/^(me|coll):/.test(row.value.scope)) row.delete();
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
  {
    version: 5,
    upgrade(tx) {
      // The learning feature was removed: drop its cached rows, its scope's
      // coverage, the discipline setting and queued answers nobody can send.
      const rows = tx.objectStore("rows").openCursor();
      rows.onsuccess = () => {
        const row = rows.result;
        if (!row) return;
        const value = row.value as { scope: string; type: string; id: string };
        if (
          value.scope === "learn" ||
          value.type === "learningCorpus" ||
          value.type === "learningProgress" ||
          (value.type === "setting" && value.id === "learning.discipline")
        )
          row.delete();
        row.continue();
      };
      tx.objectStore("scopes").delete("learn");
      const outbox = tx.objectStore("outbox").openCursor();
      outbox.onsuccess = () => {
        const entry = outbox.result;
        if (!entry) return;
        const items = entry.value as unknown;
        if (Array.isArray(items)) {
          const kept = items.filter(
            (item: { method?: unknown }) =>
              typeof item?.method !== "string" ||
              !item.method.startsWith("learning."),
          );
          if (kept.length !== items.length) entry.update(kept);
        }
        entry.continue();
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
