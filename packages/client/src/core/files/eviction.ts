import { Semaphore } from "@talos/base";
import { mergeReplica } from "@talos/sync";
import type { WindowedTypes } from "@talos/sync";
import type { Database, LockManagerLike } from "@talos/store";
import type { StoredRow } from "../data/db.ts";
import { ScopeLocks, readReplicas, writeReplica } from "../data/scope-store.ts";

interface CacheEntry {
  key: string;
  bytes: number;
  accessed: number;
}
interface Head {
  rid: string;
  written: number;
  updatedAt: number;
  state: string;
}
interface Owner {
  owner: string;
  rid: string;
}
export interface QuotaOptions {
  now?: () => number;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  fallbackBytes?: number;
  exhausted: () => void;
  onEvicted?: () => Promise<void>;
  /** Windowed row types: the only rows eviction may drop, through the replica merge. */
  windowed: WindowedTypes;
  locks?: LockManagerLike | null;
}
/** Only reconstructible entries are candidates. Unknown keys and all intent stay protected. */
export class EvictionManager {
  private readonly serial = new Semaphore(1);
  private readonly now: () => number;
  private readonly accessed = new Map<string, number>();
  private readonly locks: ScopeLocks;
  constructor(
    private readonly db: Database,
    private readonly options: QuotaOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.locks = new ScopeLocks(options.locks);
    db.setQuotaRecovery(() => this.makeRoom(0, true), options.exhausted);
  }
  touch(key: string): void {
    this.accessed.set(key, this.now());
  }
  async track(key: string, value: unknown): Promise<void> {
    if (
      !/^feature:[^:]+:(conv:[^:]+:body:|library:[^:]+:manifest|ai:full:|ai:file:)/.test(
        key,
      )
    )
      return;
    await this.db.table<CacheEntry>("cache_entries").put({
      key,
      bytes: JSON.stringify(value)?.length * 2 || 0,
      accessed: this.now(),
    });
  }
  async makeRoom(incoming: number, force = false): Promise<void> {
    return this.serial.run(async () => {
      const heads = await this.db.table<Head>("file_heads").range();
      const owners = await this.db.table<Owner>("file_owners").range();
      const caches = await this.db.table<CacheEntry>("cache_entries").range();
      const rows = await this.db.table<StoredRow>("rows").range();
      const policyStamp = (values: readonly StoredRow[]): string =>
        JSON.stringify(
          values.filter((r) =>
            [
              "chatState",
              "libraryRetention",
              "mediaRetention",
              "libraryCollection",
              "mediaPlaylist",
              "libraryDoc",
              "mediaTrack",
            ].includes(r.type),
          ),
        );
      const policiesAtScan = policyStamp(rows);
      const protectedValues = await Promise.all(
        ["kv", "outbox", "session", "nav"].map((table) =>
          this.db.table<unknown>(table).range(),
        ),
      );
      const usage =
        heads.reduce((n, h) => n + h.written, 0) +
        JSON.stringify(protectedValues).length * 2 +
        JSON.stringify(rows).length * 2;
      let estimate: { usage?: number; quota?: number } = {};
      try {
        const get = this.options.estimate;
        estimate = get ? await get() : {};
      } catch {
        /* Private mode and older browsers use tracked totals. */
      }
      const quota =
        estimate.quota ?? this.options.fallbackBytes ?? 256 * 1024 * 1024;
      let needed = (estimate.usage ?? usage) + incoming - quota * 0.9;
      if (force) needed = Math.max(needed, 1024 * 1024);
      if (needed <= 0) return;
      const expiry = (key: string, rid?: string): number => {
        let retainedUntil = 0;
        const user = key.split(":")[0];
        const library = /(?:^|:)library:([^:]+)/.exec(key)?.[1];
        const media = /(?:^|:)media:([^:]+)/.exec(key)?.[1];
        const id = library ?? media;
        if (id) {
          const area = library ? "library" : "media";
          const itemType = library ? "libraryDoc" : "mediaTrack";
          const listType = library ? "libraryCollection" : "mediaPlaylist";
          const members = library ? "docs" : "tracks";
          // Saved scheduler bookkeeping is never authoritative after policy changes.
          if (
            !rows.some(
              (row) =>
                !row.deleted &&
                row.type === itemType &&
                row.id === id &&
                (row.scope === `me:${user}` ||
                  (row.scope.startsWith("coll:") &&
                    rows.some(
                      (list) =>
                        !list.deleted &&
                        list.scope === row.scope &&
                        list.type === listType &&
                        (list.data as Record<string, string[]>)[
                          members
                        ]?.includes(id),
                    ))),
            )
          )
            return 0;
          for (const row of rows) {
            if (
              row.deleted ||
              row.scope !== `me:${user}` ||
              row.type !== `${area}Retention`
            )
              continue;
            const policy = row.data as {
              kind: string;
              value: { v: number | string; t: { ms: number } } | null;
              lastUsed: number;
            };
            if (!policy.value || typeof policy.value.v !== "number") continue;
            const individual = policy.kind === (library ? "doc" : "track");
            if (
              individual
                ? row.id !== id
                : !rows.some(
                    (list) =>
                      !list.deleted &&
                      list.type === listType &&
                      list.id === row.id &&
                      (list.data as Record<string, string[]>)[
                        members
                      ]?.includes(id),
                  )
            )
              continue;
            retainedUntil = Math.max(
              retainedUntil,
              Math.max(policy.value.t.ms, policy.lastUsed) +
                policy.value.v * 86400000,
            );
          }
          return retainedUntil;
        }
        const conv = /(?:^|:)conv:([^:]+)/.exec(key)?.[1];
        if (conv) {
          const policies = rows.filter(
            (r) => r.type === "chatState" && r.id === conv && !r.deleted,
          );
          let deadline = 0;
          for (const row of policies) {
            const state = row.data as { retention?: { v: string } };
            if (state.retention?.v && state.retention.v !== "auto") {
              const days = state.retention.v === "week" ? 7 : 183;
              const postId = /:body:([^:]+)/.exec(key)?.[1];
              const posts = rows.filter(
                (r) =>
                  r.type === "post" &&
                  r.scope === `conv:${conv}` &&
                  (!postId || r.id === postId),
              );
              const matching = rid
                ? posts.filter((r) => {
                    const post = r.data as {
                      image?: {
                        original: { rid: string };
                        thumbnail: { rid: string };
                      };
                      sticker?: { file: { rid: string } };
                    };
                    return (
                      post.image?.original.rid === rid ||
                      post.image?.thumbnail.rid === rid ||
                      post.sticker?.file.rid === rid
                    );
                  })
                : posts;
              const newest = matching.reduce(
                (t, r) =>
                  Math.max(t, (r.data as { created?: number }).created ?? 0),
                0,
              );
              deadline = Math.max(
                deadline,
                newest ? newest + days * 86400000 : Number.MAX_SAFE_INTEGER,
              );
            }
          }
          return deadline;
        }
        return 0;
      };
      const candidates: {
        priority: number;
        accessed: number;
        bytes: number;
        remove: () => Promise<void>;
      }[] = [];
      for (const head of heads) {
        const tags = owners.filter((o) => o.rid === head.rid);
        const deadline = Math.max(
          0,
          ...tags.map((o) => expiry(o.owner, head.rid)),
        );
        if (deadline > this.now() || head.state !== "complete") continue;
        candidates.push({
          priority: deadline ? 1 : 0,
          accessed: this.accessed.get(head.rid) ?? head.updatedAt,
          bytes: head.written,
          remove: async () => {
            await this.db.tx(
              [
                "file_heads",
                "file_chunks",
                "file_owners",
                "file_leases",
                "rows",
              ],
              "readwrite",
              (tx) =>
                tx
                  .table<{ expires: number }, string>("file_leases")
                  .get(head.rid)
                  .then((lease) => {
                    if (lease && lease.expires > this.now()) return;
                    return tx
                      .table<StoredRow>("rows")
                      .range()
                      .then((latestRows) => {
                        if (policyStamp(latestRows) !== policiesAtScan) return;
                        return tx
                          .table<Owner>("file_owners")
                          .byIndex<string>("rid")
                          .range({ lower: head.rid, upper: head.rid })
                          .then((current) => {
                            if (
                              JSON.stringify(
                                current.map((o) => o.owner).sort(),
                              ) !==
                              JSON.stringify(tags.map((o) => o.owner).sort())
                            )
                              return;
                            tx.table("file_heads").delete(head.rid);
                            tx.table("file_chunks").deleteRange({
                              lower: [head.rid, 0],
                              upper: [head.rid, Number.MAX_SAFE_INTEGER],
                            });
                            for (const tag of tags)
                              tx.table("file_owners").delete([
                                tag.owner,
                                tag.rid,
                              ]);
                          });
                      });
                  }),
              false,
            );
          },
        });
      }
      for (const entry of caches) {
        const deadline = expiry(entry.key.replace(/^feature:/, ""));
        if (deadline > this.now()) continue;
        candidates.push({
          priority: deadline ? 1 : 0,
          accessed: this.accessed.get(entry.key) ?? entry.accessed,
          bytes: entry.bytes,
          remove: async () => {
            await this.db.tx(
              ["kv", "cache_entries", "rows"],
              "readwrite",
              (tx) =>
                tx
                  .table<StoredRow>("rows")
                  .range()
                  .then((latest) => {
                    if (policyStamp(latest) !== policiesAtScan) return;
                    tx.table("kv").delete(entry.key);
                    tx.table("cache_entries").delete(entry.key);
                  }),
              false,
            );
          },
        });
      }
      // Windowed rows can be fetched again: eviction removes them and their
      // coverage through the replica merge, which leaves an explicit hole. Never
      // evict while queued intent may refer to them; mirrored rows are not candidates.
      const pending = await this.db.table<unknown[]>("outbox").range();
      if (!pending.some((items) => items.length)) {
        for (const row of rows) {
          if (
            !Object.prototype.hasOwnProperty.call(
              this.options.windowed,
              row.type,
            )
          )
            continue;
          const deadline =
            row.type === "post" ? expiry(`${row.scope}:body:${row.id}`) : 0;
          if (deadline > this.now()) continue;
          candidates.push({
            priority: deadline ? 1 : 0,
            accessed:
              this.accessed.get(row.scope) ??
              (row.data as { created?: number } | null)?.created ??
              row.rev,
            bytes: JSON.stringify(row).length * 2,
            remove: () =>
              this.locks.run([row.scope], () =>
                this.db.tx(
                  ["rows", "scopes", "outbox"],
                  "readwrite",
                  (tx) =>
                    tx
                      .table<StoredRow>("rows")
                      .range()
                      .then((latest) => {
                        if (policyStamp(latest) !== policiesAtScan) return;
                        return tx
                          .table<unknown[]>("outbox")
                          .range()
                          .then((intent) => {
                            if (intent.some((items) => items.length)) return;
                            return readReplicas(tx, [row.scope], (held) => {
                              const before = held.get(row.scope)!;
                              writeReplica(
                                tx,
                                row.scope,
                                before,
                                mergeReplica(
                                  before.replica,
                                  {
                                    kind: "evict",
                                    type: row.type,
                                    ids: [row.id],
                                  },
                                  this.options.windowed,
                                ),
                              );
                            });
                          });
                      }),
                  false,
                ),
              ),
          });
        }
      }
      candidates.sort(
        (a, b) => a.priority - b.priority || a.accessed - b.accessed,
      );
      for (const candidate of candidates) {
        if (needed <= 0) break;
        await candidate.remove();
        needed -= candidate.bytes;
      }
      await this.options.onEvicted?.();
    });
  }
}
