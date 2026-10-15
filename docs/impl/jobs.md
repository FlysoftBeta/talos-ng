# Jobs and the task projection

Server kernel `kernel/jobs` (durable job runner) and the `tasks` module (owner-scoped
projection). Entry points: `packages/server/src/kernel/jobs/jobs.ts`,
`packages/server/src/modules/tasks`.

## Why jobs

Document conversion, network-novel downloads, media materialisation, AI runs, backups and
user purge are long or externally dependent. As durable rows they survive restarts and show
up in the owner's task list through sync, with no polling. The server is a single process
with synchronous SQLite, so heavy work is child processes or chunked asynchronous I/O, not
worker threads.

## Runner

`jobs(id, kind, owner, payload, state, progress, message, result, error, attempts, run_after,
created, updated)`; states `queued, running, done, failed, cancelled`. Each kind registers
`{concurrency, timeoutMs, onBoot: 'requeue' | 'fail', retryable?, run(ctx)}` before the runner
starts; handlers receive `{id, owner, payload, signal, progress(value, message?)}`.

- **Boot recovery**: `running` rows are re-queued or failed according to the kind. Re-queued
  kinds must be idempotent (completed work makes a rerun a no-op).
- **Concurrency is per kind and holds until the handler settles.** Timeout and cancellation
  abort the signal but keep the slot occupied until the worker returns, so an uncooperative
  worker cannot exceed the cap. Closing the runner aborts workers and leaves running rows to
  the next boot's policy.
- Cancellation aborts workers only after its transaction commits. Unknown handler errors are
  reported internally and surface as a generic `E_INTERNAL`; unserialisable results fail the
  job. Progress is throttled with a trailing update; terminal transitions flush it.
- Jobs are synced rows; every change bumps the revision and reaches the owner's `me:` scope.
  Cancelling all work of an owner (`cancelOwner`) awaits active cleanup even if the job row
  was already cleared. Admission, retry and start reject owners marked as being purged.
- Job kinds that run kernel-level work register in the module that owns the domain
  (`library.convert`, `media.materialise`, netbooks downloads, `ai.run`, `ops.backup.daily`,
  `admin.user.purge`).

## Task projection (`tasks`)

The projection has no tables; `kernel.jobs` owns durable state. It exposes the owner's rows in
`me:<user>` and three online-only methods: `tasks.cancel`, `tasks.retry`, `tasks.clear`.

- Only an explicit display title is projected from the payload, plus state, progress,
  estimated remaining time and error; other payload and scheduling fields stay private.
  Unknown kinds display as a generic "background task" label, never an internal identifier.
- **Retry is a per-kind capability** (`retryable`): only kinds where repeating the same
  payload is safe opt in. A failed or cancelled job retries only after its old handler has
  settled, so a late completion cannot overwrite the new attempt; the job id and attempt
  count are preserved.
- `tasks.clear` with no id tombstones older terminal rows but keeps the newest 100 terminal
  records and every queued or running job; with an id it removes one terminal row.
- The estimated remaining time uses progress and elapsed time of the current attempt only;
  zero or unknown progress has none.
- `debug.sleep` exists only in dev mode.
