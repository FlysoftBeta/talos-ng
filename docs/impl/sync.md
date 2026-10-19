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
- `snapshot(user, request)` computes a request's pages at one revision without touching
  subscription state; `pull` is snapshot plus bookkeeping. `pullFrom` takes the snapshot
  from a read replica (`server.md`): commits and access refreshes that land while it is in
  flight are recorded, the touched scopes are returned with `more` and stay incomplete,
  scopes that lost access are dropped and the response carries `repull`, so the client pulls
  again; that retry is computed on the main thread and cannot race. A disconnect or rebind
  during the snapshot fails the pull instead of installing a subscription.
- Entity types whose writes can never change scope access (posts, chat and reading states,
  settings, progress, jobs, AI messages) are registered `accessNeutral`. A change set made
  only of such rows reuses each subscription's known scopes instead of re-evaluating every
  provider per connected user, and skips the per-connection re-authentication; admission
  changes made outside units of work (device policy, device lock or removal) re-authenticate
  connections themselves.

## Windowed types

Posts (and AI messages) are too large to mirror. The client keeps windows of them by
sequence number, and what it knows is stored as explicit **coverage**, never implied by a
cursor. Sequence numbers must be stable per row id. Pages are bounded in rows and
serialised bytes so a header never overflows; large bodies are fetched separately as
binary chunks.

- A pull lists the scopes holding windows (`windowed`); every other scope gets no windowed
  rows. Each scope page says whether it carries them (`windowed: true`), and so does each
  push: the server keeps the set from the pull that installed the subscription. A `reset`
  for a type means its rows were withheld because too many changed.
- A window page (`chat.post.page`, `ai.message.page`) returns the server revision `rev` it
  was read at; it vouches for every sequence number from its first to its last post as of
  `rev` (an absent row there means no row existed). A row read individually, such as a
  write result, vouches for its own sequence number as of its own revision.

## Scope replicas (`mergeReplica`)

A scope replica is its rows plus its coverage, persisted in one IndexedDB transaction:

- `revs`: revision interval set whose every change to the scope's mirrored types arrived;
  `0` is present once a chain from the empty start arrived. The request cursor is the top
  of the run from `0` (`cursorOf`), the scope is complete when `0` is held (`isComplete`).
- Per windowed type, `revs` (revisions whose changes of that type arrived: only chains
  marked `windowed` without a reset of it add them) and `known`: sorted ranges
  `[lo, hi, at]` meaning the stored state of each sequence number is at least the server
  state at `at`. Each `at` is closed under the type's `revs` (it advances through every
  run of received revisions after it). A sequence number is current when its `at` reaches
  the scope cursor; every other one is a **hole** (`holes(coverage, type, lo, hi)`): never
  loaded, evicted, withheld by a reset, or loaded before changes the replica did not get.
  Nothing outside a hole can be missing, so loss is never silent.

Every inbound change goes through the one pure merge, `mergeReplica(replica, input)`:

- `chain {from, pages}`: a complete pull or push chain continuing the server's stream from
  `from`. All its rows merge; `from+1..top` joins `revs` (and the windowed types' `revs`
  when the pages carry them); every windowed row vouches for itself.
- `page {type, rows, lo, hi, rev}` and `rows {rows}`: window pages and individual reads.
- `evict {type, ids}`: forgets windowed rows and their sequence numbers. It leaves a `cut`
  at the highest revision the replica knew for them, so a late older fact cannot be
  closed over revisions whose changes were thrown away.
- `purge`: revocation or first admission for another account forgets the whole scope.

Rows resolve by revision; a windowed tombstone is final (mirrored rows may return).
Remote inputs only add facts (row union by that order, interval unions, pointwise maximum
of `at`), so they commute, associate and are idempotent: the main pull, window pages,
backfills, pushes and other tabs' commits reach the same replica in any order and any
number of times. Eviction and purge are the explicit removals. Incomplete chains are
buffered by the engine and never merged; a chain's validation (cursor order, row
revisions) rejects it whole.

`replica.test.ts` checks this with randomized interleavings of server writes, pulls,
window pages, hole backfills, write results, pushes to two tabs, evictions and reloads
against a server log: after every step each server row at the cursor is stored or inside a
hole, the replica converges once in-flight answers land and the holes are fetched, and
any permutation with repetitions of the merged inputs gives the same replica. Restoring
the old rule that only the newest window may grow fails both properties.

## Conflict rules

All pure, commutative, associative and idempotent over valid histories; the server applies
the same functions to queued writes, so two offline devices converge without a proposal
side channel.

- `Lww<T>` `{v, t:{ms,counter}, op}`: greatest `(ms, counter, op)` wins (settings, drafts,
  mute, pin, resume position, theme). `clampFutureStamp` caps stamps above `now + maxSkew`.
- `Max`: monotonic numbers or `{seq,id}` cursors (read cursor, furthest reading position,
  announcement acknowledgement by revision).
- Counters per device: grow-only per device, merged by maximum per field, summed for display
  (reading seconds).
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
  keep a conservative module-wide barrier.
- **Register writes** are order-irrelevant state upserts (last-writer-wins, maximum,
  per-device counters) that a module declares per method with a register key, a merge
  and an optional debounce: chat pin/mute/draft/retention per conversation, read marks,
  AI drafts and read marks, reading progress per document and device, settings per key,
  the media queue. They bypass order-key FIFO (a failed message never holds a draft back)
  but only one write per register flies. Enqueueing merges a pending write to the same
  register into the new one: the new operation id carries the merged arguments (an old
  id may already be applied, and its cached result would hide the new value), the
  earlier creation time and the union of dependencies. Sending, failed and referenced
  writes never merge. Debounced writes wait `notBefore` (drafts 1.5 s, read marks 1 s,
  reading progress 3 s after the last edit), bounded by a `deadline` of four quiet periods
  after the first. The merged list is persisted like any other outbox state, so a reload
  keeps the coalesced intent and acknowledged writes are never touched.
- **Batching.** Each flush step sends every eligible operation in one request, up to 32
  operations and 64 KiB of arguments: the head of each strict order key plus due register
  writes. Two operations whose order matters never share a request (same key, or a
  dependency on an outstanding operation), so the entries are mutually independent.
  `sync.push {ops:[{op, method, args}]}` runs them through the ordinary dispatch one by
  one, each with its own idempotency record and write transaction, and answers per
  operation (`{op}` or `{op, error}`); a single eligible operation uses its method
  directly. One pull then precedes the acknowledgements of all accepted operations.
- `op` is the idempotency key; the server remembers results for 14 days, so a late success
  after a connection loss is harmless.
- Ack removes the item **only after** the authoritative rows arrive by delta/pull; the
  optimistic mark clears then. Optimistic data is never promoted to authoritative base.
- Terminal rejections (`E_DENIED, E_INVALID, E_NOT_FOUND, E_CONFLICT, E_TOO_LARGE`) make the item
  `failed`; the affected rows roll back and are re-pulled; the activity centre offers retry or
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
pull chains merged atomically per scope (rows and coverage, admitted scopes, last-sync
time), delta application, outbox flush, retention downloads and quota eviction.

**One writer per scope.** Every merge (pull and push commits, window pages, eviction)
reads the scope replicas, merges and writes them in one readwrite transaction, inside the
Web Locks of the touched scopes (`talos-sync:<scope>`, taken in sorted order, so tabs
cannot deadlock). Without `navigator.locks` the transaction alone serializes writers.
Correctness does not depend on the lock: a merge is a pure function of the stored replica
and its input. Persisted
per-user scope admission stops one user's cached shared data projecting into another user's
session. Revision checks stop stale push/pull data regressing state. Navigator `onLine` is
only a negative hint; going offline interrupts the carrier and leaves reconnect to the link
retry machine.

A pull commits each scope as soon as its own page chain is complete, while other scopes
keep paging, so conversations, documents and settings that already arrived are usable
(and open) before the whole pull finishes. Each scope chain remains atomic, the request
base advances with each commit, and revocations reported by the pull stay with the final
commit (a later page may regrant the scope). Until the final commit a durable
`partialSync` marker keeps `cacheReady` false, also across a reload, because scopes then
sit at different revisions. A pull also lists the scopes holding windows (`windowed`);
the server omits windowed rows of every other scope, so a large conversation's history
does not page through its first sync. A page that opens a window in a scope whose pushes
do not carry windowed rows schedules a pull; until it lands, that window can only turn
into holes, never into silent loss.

The engine snapshot exposes this as `scopeSync` while a pull pages: each admitted scope is
`waiting`, `loading` (rows buffered so far) or `ready` (already complete: committed earlier in
this pull, or from a previous session), and the list is empty once the final commit lands.
The activity centre shows it so the user sees which scopes can already be used. Merged
register writes also count the earlier writes folded into them (`merged` on the outbox item)
for the same display.

Each pushed page continues the scope's stream from where this connection's last final
pull page or push for it ended (recorded on arrival, before any await), so pushes merge
immediately, even while a pull is buffered: the cursor cannot pass revisions that did not
arrive. A push without a known start merges its rows but proves no revisions and requests a
pull. Revocations purge immediately and carry per-scope
epochs that prevent an older pull or queued delta from restoring access. Generation fences
also cover successful old-session replies. A failed pull or delta marks synchronization
dirty, blocks cursor advancement and outbox flushing, and schedules a fresh pull with
500 ms–30 s exponential backoff. Malformed delta events trigger the same authoritative
repair. Authentication, lock and version failures pause instead of retrying indefinitely.

A pull starts from the current user's admitted scopes, not every cached scope in the shared
IndexedDB database. First admission purges inherited rows and coverage before merging a
complete snapshot from zero. Request bases are the cursors the stored coverage proves when
the pull starts; another tab committing the same scope meanwhile needs no restart, because
both chains only add facts.

Scope purges atomically persist per-user cleanup markers alongside row removal. Module
cleanup retries after failed callbacks or restarts, even when the server no longer reports
the scope as gone. A new grant cancels stale cleanup; callbacks and lease updates remain
fenced to the owning session.

An open conversation fetches the holes among its visible posts automatically (a hole
that closes and opens again is fetched again; after a failure the manual action remains).

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
