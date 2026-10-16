# Client storage: `@talos/store` and the client database

Entry points: `packages/store/src/index.ts` (engine, `KV`, `FileStore`),
`packages/store/src/testing` (fake IndexedDB environment),
`packages/client/src/core/data/db.ts` (schema), `packages/client/src/core/files` (retention,
eviction).

## Rules

- **IndexedDB only; never Blob or File values.** Values are structured-clone plain data,
  strings and `ArrayBuffer`. The write guard is always on (also in production): it walks the
  value (cycle-safe, Map/Set, cross-realm) and rejects Blob/File and duck-typed equivalents,
  functions, symbols, DOM nodes and enumerable accessors. Blob URLs are created at use time
  and revoked, never stored. No Cache Storage, no `localStorage`/Web Storage.
- Two databases: `talos-shell` (owned by `@talos/shell`: installed builds) and `talos-app`
  (owned by the client). `@talos/store` owns no names or schema.
- Reconstructible data (mirrors, files) may be evicted; the outbox, drafts and session
  records never are.

## Engine

- `openDb({name, schema:[{version, upgrade(tx)}], ...})`: versions strictly increasing; all
  outstanding migrations run in one native upgrade transaction using synchronous IndexedDB
  schema calls (no network, no awaiting). Migrations are append-only: never edit a shipped
  one. A blocked upgrade times out with `E_BUSY`; a version change closes and invalidates the
  wrapper (`E_VERSION`).
- Typed `Table` (get/put/delete/range/index, bulk ops) and `db.tx(stores, mode, fn)`.
  Inside a transaction every operation returns a synchronous `TxTask` thenable; chain
  `.then()` to run dependent requests inside the native success event. **Callbacks must not
  be `async` and must not await native promises, timers or fetches**; that would let the
  transaction auto-commit on Chrome 70, so such callbacks are rejected with `E_INVALID` and
  the transaction aborts. Resolve external work before entering a transaction.
- Errors map to `AppError`: quota is `E_TOO_LARGE` with `data.quota`, constraint failures
  `E_CONFLICT`, native abort `E_CANCELLED`. A callback error rolls back every queued write.
- `db.subscribe(tables, fn)`: one coalesced `{tables}` event per committed write
  transaction, delivered locally and to other tabs via a database-scoped `BroadcastChannel`.
  Notifications are invalidation hints; tabs rehydrate after reopening.
- `KV`: JSON-compatible values or a top-level `ArrayBuffer` under string keys.
- Quota recovery: `setQuotaRecovery(recover, exhausted)` lets the application evict; a
  quota-aborted transaction is retried **once** after recovery, recovery transactions do not
  recurse. The store never decides what to evict.

## FileStore

Content-addressed by `rid` (lowercase SHA-256 of the decoded bytes), stored as chunks of at
most 1 MiB under `[rid, n]` with a head `{rid, size, chunks, state}`. Internal stores:
`file_heads`, `file_chunks`, `file_owners` (`[owner, rid]`), `file_leases`.

- Resumable writer: `begin(rid, size)` returns `written` as the durable resume offset;
  `append` merges into chunk layout and advances the offset in the same transaction;
  `commit` verifies size, chunk layout and SHA-256 (WebCrypto up to 8 MiB, otherwise
  incremental pure-JS `Sha256` per chunk, never concatenating the file) and marks the head
  complete. Integrity failures delete the file and return `E_INTEGRITY`.
- **Leases with fencing tokens**, checked in every mutation transaction, protect an idle
  writer until the lease expires (30 s default), so a suspended or crashed tab cannot
  overwrite a successor. Web Locks, when present, only serialise per-file operations; the
  persisted fencing protocol stays authoritative. An expired writer gets `E_BUSY` and must
  begin again. No heartbeat or real timers are required.
- `read(rid, {start,end})` needs complete content, half-open ranges, one snapshot
  transaction over the intersecting chunks. `readChunks` yields at most 1 MiB per step; hold
  an owner for the duration of a stream if another tab might run GC.
- Owners: `retain(owner, rid)` / `release` / `releaseOwner`; owner strings are
  `<kind>:<id>` and the prefix before the first colon is the accounting group in `usage()`
  (bytes counted once per prefix, so prefix sums may exceed physical use).
- `gc({incompleteOlderThanMs})` removes unowned complete files and stale incomplete ones in
  bounded transactions (32 heads, 32 chunks or owners at a time); files pass through a
  `deleting` state first so retain/read/begin cannot race a resurrection. Interrupted
  deletions finish on a later GC.
- File operations own their multi-step transactions and cannot join a caller's transaction;
  table/KV data can via `tx.table`.

## Client database (`talos-app`)

| Store | Key and contents |
|---|---|
| `rows` | `[scope, type, id]`: authoritative revisioned data and tombstones |
| `scopes` | scope: last **completed** pull cursor |
| `outbox` | user id: durable FIFO array including sending/failed items |
| `session` | `device` and `active`: device id, token, user, expiry, PIN verifier |
| `nav` | user id: validated navigation reducer value |
| `kv` | per-user admitted scopes, last-sync time, local metadata |
| file stores | `createFileStores(tx)` heads/chunks/owners/leases |

Feature settings are synced `setting` rows, never a second authority. Generic row types need
registration only, not new physical stores; add a migration only when the generic row/KV
stores cannot hold a feature's local data, and test opening the old schema.

The device id is a stable id generated in the browser and registered with the server; it is
kept across a local reset (which deletes and rebuilds only `talos-app`; a blocked deletion
stays pending with a close-other-tabs message because IndexedDB deletion cannot be aborted).

## Retention and eviction

`core/files` owns retention downloads and one `EvictionManager` for FileStore content,
reconstructible mirrors and windowed history.

- Quota source: `navigator.storage.estimate()` when available, else tracked payload totals
  with a 256 MiB fallback; `navigator.storage.persist()` is requested after login. Failed
  estimates never invent figures.
- Eviction runs above a 90% watermark in this order: unowned files, ordinary caches by last
  access, expired retention. Drafts, sessions, the outbox and in-window retention are
  protected; mirrors are not removed while user intent is pending for them.
- A quota abort evicts and retries the whole transaction once; exhaustion publishes
  `存储空间不足` in the status centre.
- Retained documents/audio/conversations download through resumable ranged `/dl/` fetches
  into FileStore writers, in a serialised background queue that resumes after reconnect and
  runs independently of any viewer; cancellation or revocation is re-checked after each
  download completes. Only complete, hash-verified content is readable offline. Owners are
  scoped to users and content (`library:<doc>:retained`, `media:<track>:retained`,
  `conv:<id>`), with retained item access checked against admitted rows. Library/media
  schedulers aggregate only the current user's item and collection policies; eviction
  protection likewise uses the owner's personal policy. Network headers and streamed
  chunks time out after 30 seconds without progress; retries keep the durable offset.
  Binary downloads are bounded to four concurrent calls per runtime so sends and sync keep
  transport capacity.
