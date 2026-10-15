import { Semaphore } from "@talos/base";
import type { Database } from "@talos/store";
import type { StoredRow } from "../data/db.ts";

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
interface Retained {
  expires: number;
  doc?: string;
  playlist?: string;
  track?: string;
}
export interface QuotaOptions {
  now?: () => number;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  fallbackBytes?: number;
  exhausted: () => void;
  onEvicted?: () => Promise<void>;
}
/** Only reconstructible entries are candidates. Unknown keys and all intent stay protected. */
export class EvictionManager {
  private readonly serial = new Semaphore(1);
  private readonly now: () => number;
  private readonly accessed = new Map<string, number>();
  constructor(
    private readonly db: Database,
    private readonly options: QuotaOptions,
  ) {
    this.now = options.now ?? Date.now;
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
            ["chatState", "libraryState", "mediaPlaylist"].includes(r.type),
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
      const retained = new Map<string, number>();
      const users = new Set(
        rows
          .filter((r) => r.scope.startsWith("me:"))
          .map((r) => r.scope.slice(3)),
      );
      for (const { owner } of owners) users.add(owner.split(":")[0]!);
      for (const user of users) {
        for (const area of ["library", "media"]) {
          const values = await this.db
            .table<Retained[], string>("kv")
            .get(`feature:${user}:${area}:retained`);
          for (const value of values ?? [])
            retained.set(
              area === "library"
                ? `${user}:library:${value.doc}`
                : `${user}:media:${value.playlist}:${value.track}`,
              value.expires,
            );
        }
      }
      const expiry = (key: string, rid?: string): number => {
        let retainedUntil = 0;
        for (const [prefix, expires] of retained)
          if (key.startsWith(prefix))
            retainedUntil = Math.max(retainedUntil, expires);
        const library = /(?:^|:)library:([^:]+)/.exec(key)?.[1];
        const media = /(?:^|:)media:([^:]+)/.exec(key)?.[1];
        for (const row of rows) {
          if (row.deleted) continue;
          if (library && row.type === "libraryState" && row.id === library) {
            const policy = (
              row.data as {
                retention?: { v: number | string; t: { ms: number } };
              }
            ).retention;
            if (policy && typeof policy.v === "number")
              retainedUntil = Math.max(
                retainedUntil,
                policy.t.ms + policy.v * 86400000,
              );
          }
          if (media && row.type === "mediaPlaylist" && row.id === media) {
            const policy = row.data as {
              lastPlayed: number;
              created: number;
              retentionDays: number;
            };
            retainedUntil = Math.max(
              retainedUntil,
              Math.max(policy.lastPlayed, policy.created) +
                policy.retentionDays * 86400000,
            );
          }
        }
        if (library || media) return retainedUntil;
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
      // Windowed mirrors can be reconstructed on the next pull. Never evict while
      // queued intent may refer to them; state/draft/profile rows are not candidates.
      const pending = await this.db.table<unknown[]>("outbox").range();
      if (!pending.some((items) => items.length)) {
        for (const row of rows) {
          if (row.type !== "post" && row.type !== "aiMessage") continue;
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
            remove: async () => {
              await this.db.tx(
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
                          tx.table("rows").delete([
                            row.scope,
                            row.type,
                            row.id,
                          ]);
                          tx.table("scopes").put({
                            scope: row.scope,
                            cursor: 0,
                          });
                        });
                    }),
                false,
              );
            },
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
