# Sync client correctness and retry recovery

## Prompt

Audit and repair client synchronization, outbox errors/retries, generation changes and
scope revocation. Reproduce the real SyncHub/SyncEngine historical-row loss when a completed
scope receives a push while another scope is still paging. Preserve resets, atomic cursor
updates, Chrome 70 compatibility and IndexedDB storage. Add meaningful regression tests,
coordinate oversized-response framing with the wire task, and commit without pushing.
Do not introduce a database migration or edit retention policy behavior.

## Results

- Pull chains and ordinary deltas share a serialization gate, preventing pushed cursors
  from skipping buffered historical rows. Stale resets remain rejected. Failed apply/pull
  leaves a repair barrier so later pushes cannot skip missing rows.
- Revocation purges immediately. Per-scope epochs prevent in-flight pulls and queued older
  deltas from readmitting a revoked scope. Session/generation checks cover successful RPC
  responses, queued writes, acknowledgments and transaction mutation callbacks.
- Initial and subsequent synchronization failures retry with capped exponential backoff.
  Malformed event payloads enqueue an authoritative repair before subsequent valid events.
  Successful recovery restores live status and resumes intent delivery. Auth, lock and
  version failures pause delivery instead of retrying indefinitely.
- A confirmed write followed by a failed reconciliation read stays pending with its original
  idempotency key; it is never classified as a rejected write. E_TOO_LARGE is a terminal
  write rejection, with normal retry/discard handling.
- FIFO barriers default to each module, with explicit per-setting and per-conversation
  keys. Chat text upload prerequisites are inferred and persisted using the existing
  dependsOn field, keeping consumers behind failed uploads while unrelated conversations
  proceed. No storage schema change is required.
- Client assembles rotating-token wire fragments before schema validation/application;
  expired transfers restart from durable cursors. Final-fragment repull hints force catchup;
  clean completed fragments finish immediately. Contract changes belong to the wire task.

## Verification

- Full client/sync suites: 80 files, 755 tests passed before final focused additions.
- Final focused runtime, engine, chat module and outbox regression suites: 138 tests
  passed; includes malformed-event repair, chat upload dependencies and version
  pause, alongside pagination/reset/revocation/fragment/generation/error cases.
- Client and sync production/test typechecks, scoped ESLint and formatting passed.
- Client production build passed; static Chrome 70 compatibility: 10 files, 0 violations.
- The supplied real SyncHub/Engine audit scenario now persists historical-A and new-C at
  cursor 9 with no missing rows. Its harness releases the final response before awaiting
  the deliberately serialized delta.

## Limits and decisions

Memory still grows with a complete logical pull, as before; wire fragmentation bounds
individual frames rather than total synchronized data. Other modules retain conservative
module-wide barriers until their own dependency-safe object keys are supplied. The parent
owns combined contract/client integration, full application gates, and pushing. Native
Chrome 70/browser e2e and full package gates were not run in this worktree.

## Follow-up: durable revoked-scope cleanup

Scope purge now atomically merges a per-account cleanup marker into existing IndexedDB kv
storage. Every successful apply and hydration drains pending cleanup, removing each marker
only after its idempotent callback succeeds in the current generation. A failed callback
survives restart and a later pull that no longer reports gone. Another account never drains
these markers. A regranted scope cancels its obsolete cleanup marker before admitting fresh
rows; session callbacks check account-engine identity and generation between storage steps.

A scope revoked then returned by a later page in the same chain is now purged and admitted
atomically with fresh cursors/windows, rather than silently skipped. Four regression tests
cover cleanup failure/retry, generation/account restart, regrant cancellation and paginated
regrant. No database schema change or migration is needed.
