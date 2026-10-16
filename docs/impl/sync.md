# Sync and offline

Packages: `@talos/sync` (pure algorithms, depends on `base` only: no storage, network, timers,
randomness or module state), server `kernel/sync` (`SyncHub`), client `core/data` (sync
engine, outbox executor, repositories). Entry points: `packages/sync/src/index.ts`,
`packages/server/src/kernel/sync/sync-hub.ts`, `packages/client/src/core/data/sync-engine.ts`.

## Principle

Row-revision sync over access scopes. **Pull on every connect is the correctness mechanism;
pushed deltas are an optimisation.** One mechanism replaces per-feature revision sums and
snapshots. Client writes go through a durable outbox with idempotency keys, optimistic local
reducers and shared pure merge functions.

## Scopes and revisions (server to client)

Synced state is rows in **scopes**; a scope is the unit of access control and subscription:

- `me:<user>`: profile, settings, roles/gates, device state, own conversation states, own
  grants, own jobs, own library/media/AI lists, own progress.
- `conv:<id>`: conversation metadata, visible members, posts. `coll:<id>`: collection or
  playlist metadata and items. `ai:<conversation>`: windowed AI messages. `learn`: the
  word corpus. `sys`: announcement, global locks, public config.
- Admin data is never synced; the workbench is online with paged calls.

Every write bumps the global `rev` inside its transaction and stamps the rows it touches.
`sync.pull({cursors:{[scope]:rev}})` returns per scope `{rows:[{type,id,rev,deleted,data}],
cursor, more, reset?}` plus `gone` and `added` scope lists. After a scope's final page the
connection is subscribed and later commits push the same row shapes as `sync.delta` events.
Losing access puts the scope in `gone` (the client purges it); gaining access lists it in
`added` and it syncs from 0. Memberships and grants changes must therefore refresh the
affected scopes (`SyncHub.refreshAccess`, and re-projection of grants when community
membership changes).

### Server `SyncHub`

Scope providers (`match, access, list, select`) and entity serialisers register at startup.

- A scope shared by several providers is visible only if **every** matching provider grants
  access, and providers are combined before paging so transaction boundaries stay intact.
  Provider `select` results are ordered by revision, strictly after the cursor, tombstones
  included; `selectDelta` keeps the last revision group whole (the row limit is soft).
- Pull and point reads must serialise identically, tombstones included. Serialisers may
  transform data but not row identity or revision.
- A connection subscribes to a scope only after its final pull page; rebinding replaces the
  previous subscription. Pushes after commit re-read touched rows from the committed state.
- Memory stays bounded: changes are scanned in batches retaining candidate rows for the first
  page plus the next revision group, per entity type; counts continue to detect window resets.

## Windowed types

Posts (and AI messages) are too large to mirror. The client keeps contiguous **intervals** by
sequence number (`IntervalSet`: closed, canonical, merged on overlap and adjacency). Deltas
cover the whole scope; the client applies rows inside held windows and consecutive
extensions of the greatest window, and ignores rows in gaps. If more than a threshold of
changes accumulated, the server answers `reset` for that type and the client keeps only what
it re-fetches through explicit page calls (`mergePage` certifies a fetched range; an empty
complete page certifies absence). Windowed rows are never seeded by deltas into an empty
window. Sequence numbers must be stable per row id. Pages are bounded in rows and serialised
bytes so a header never overflows; large bodies are fetched separately as binary chunks.

## Applying pulls (`planApply`)

The planner turns a complete pull, or a buffered ordered chain of pages, into operations an
executor runs in **one transaction**: conditional `put`/`delete` (only if `row.rev` is newer
than the held revision; a missing revision compares below zero), `dropType`, `setWindow`,
`setCursor`. Deletion revisions are kept so old history pages cannot resurrect deleted rows.
An incomplete chain (`more` on the last page) produces no operations; on disconnect buffered
pages are discarded and the pull restarts from the durable cursor. The cursor is persisted
only with the rows. The caller serialises planning per scope. Conditional operations (not
injected storage reads) keep revision checks transactional and work with sync or async
executors. Memory grows with the whole pull; servers use `reset` to bound large types.

## Conflict rules

All pure, commutative, associative and idempotent over valid histories; the server applies
the same functions to queued writes, so two offline devices converge without a proposal
side channel.

- `Lww<T>` `{v, t:{ms,counter}, op}`: greatest `(ms, counter, op)` wins (settings, drafts,
  mute, pin, resume position, theme). `clampFutureStamp` caps stamps above `now + maxSkew`.
- `Max`: monotonic numbers or `{seq,id}` cursors (read cursor, furthest reading position,
  announcement acknowledgement by revision).
- Counters per device: grow-only per device, merged by maximum per field, summed for display
  (reading seconds, learning progress). Learning clears an observed wrong answer by recording
  an observed-prefix per source device, so unseen concurrent errors survive.
- Immutable facts and tombstones: a deletion beats any live fact; otherwise the greater
  revision wins (posts, documents). Tombstones never resurrect (SQL triggers on posts).
- Identities must not be reused for different payloads.

## Outbox (client to server)

`reduceOutbox` is a pure reducer; the executor persists the list **before** any network
effect. Item: `{op, method, args, body?, createdAt, state: pending|sending|failed, attempts,
error?, dependencies}`.

- FIFO per ordering key; only the first outstanding operation per key may fly; a failed or
  dependency-blocked head blocks its key. Modules declare independent object keys (chat
  conversations, settings keys, library targets and media targets); unspecified modules
  keep a conservative module-wide barrier. Default capacity is one in flight in the app.
- `op` is the idempotency key; the server remembers results for 14 days, so a late success
  after a connection loss is harmless.
- Ack removes the item **only after** the authoritative rows arrive by delta/pull; the
  optimistic mark clears then. Optimistic data is never promoted to authoritative base.
- Terminal rejections (`E_DENIED, E_INVALID, E_NOT_FOUND, E_CONFLICT, E_TOO_LARGE`) make the item
  `failed`; the affected rows roll back and are re-pulled; the status centre offers retry or
  discard. Every other error, including transport loss, returns it to pending with backoff
  (500 ms doubling to 30 s; a hint, the executor enforces it). Auth/version/lock errors
  pause flushing at the application level.
- A confirmed write whose follow-up pull fails stays pending with its original idempotency
  key and optimistic layer. A failed read never reclassifies that write as rejected.
- Dependencies must already be queued (no cycles). Discarding a dependency fails its
  dependents with `E_CONFLICT`; a discarded dependency cannot recover, so dependents are
  recreated with new ids. A sending item cannot be discarded.
- Chat records outstanding text uploads as durable prerequisites before enqueueing the
  dependent message or draft, so isolating conversation queues cannot bypass uploads.
- `coalesce` lets a later pending whole-register LWW write replace an earlier pending one;
  sending, failed, dependency-bearing and referenced operations are barriers. Never implicit.
- No UI action silently drops an intent.

### Optimistic projections

`pendingRow(base)` / `withPending(row, op, patch)` overlay shallow field patches in enqueue
order over the authoritative base; `updateAuthoritative` rebases, `rollback` removes one
operation's patch, `settle` removes the mark after the authoritative result is installed.
Patches are serialisable data, not closures. Queued methods have a pure local reducer
`{user, op}`-parameterised that replays deterministically after a crash.

## Client sync engine

One state machine: `offline, connecting, authenticating, syncing(progress), live`, with
independent `locked` and `updating` flags. It owns session resume, pull on connect, buffered
pull chains committed atomically (rows, tombstones, admitted scopes, cursors, last-sync
time), delta application, outbox flush, retention downloads and quota eviction. Persisted
per-user scope admission stops one user's cached shared data projecting into another user's
session. Revision checks stop stale push/pull data regressing state. Navigator `onLine` is
only a negative hint; going offline interrupts the carrier and leaves reconnect to the link
retry machine.

Full pull chains and deltas share an application gate: a newer delta cannot advance a
cursor past buffered historical rows. Revocations purge immediately and carry per-scope
epochs that prevent an older pull or queued delta from restoring access. Generation fences
also cover successful old-session replies. A failed pull or delta marks synchronization
dirty, blocks cursor advancement and outbox flushing, and schedules a fresh pull with
500 ms–30 s exponential backoff. Malformed delta events trigger the same authoritative
repair. Authentication, lock and version failures pause instead of retrying indefinitely.

A pull starts from the current user's admitted scopes, not every cached scope in the shared
IndexedDB database. First admission replaces inherited rows and windows before applying a
complete snapshot from zero. At commit, compare each admitted scope's current cursor with
the captured request base: another tab may advance it, while eviction may reset it. Either
change aborts the transaction and restarts the pull, at most twice immediately before normal
backoff. Progress counts the current attempt. This preserves strict page-chain validation
without treating another account's cached cursor as the first page's lower bound.

Scope purges atomically persist per-user cleanup markers alongside row removal. Module
cleanup retries after failed callbacks or restarts, even when the server no longer reports
the scope as gone. A new grant cancels stale cleanup; callbacks and lease updates remain
fenced to the owning session.

Retention content (documents, conversations, audio the user keeps offline) is downloaded by
background schedulers using resumable ranged fetches into the file store (see
`client-store.md`); the eviction order is in that document.

### Large sync pages and push recovery

The wire budget covers the serialized response, including scope metadata and JSON
escaping, with room below the link header limit for its envelope. Whole revision
groups remain indivisible logical pages. If a legal group or single corpus row
exceeds that budget, `sync.pull` returns empty scopes plus
`transfer: {token, chunk, more}`. Concatenate the JSON string chunks and validate
the reconstructed normal result before applying any row or cursor. Request each
next fragment with `continuation: token`; tokens rotate after consumption, are
bound to the user and connection, and expire after 60 seconds of inactivity.
A new ordinary pull replaces an abandoned transfer; disconnection clears it.
Revocation invalidates a transfer. An expired, consumed or revoked continuation
returns `E_CONFLICT`: discard the incomplete chain and restart at durable cursors.

The server suspends that connection's incremental subscription until the final
fragment. If relevant writes or newly accessible scopes appeared during transfer,
the final fragment also has `repull: true`: mark the reconstructed scope pages
`more: true` and continue pulling from their cursors. Otherwise, the server activates
completed scopes immediately. This also lets metadata-only transfers converge when
there are thousands of scopes. Oversized or failed push deltas likewise
suspend incremental delivery and send `{scopes:{},gone:[],added:[],repull:true}`.
The client pulls from durable cursors before resuming live delivery; later small
deltas cannot silently advance beyond a missing large transaction.

The request cursor map still occupies one link header. Fragmented responses do not
remove that existing request-size ceiling for extreme numbers of scope IDs.
