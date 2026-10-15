# Library containers — implementation result

Implemented on `m/library-containers`; no push or merge. Full integration gates remain with
the orchestrator. No changes to HANDOFF, ROADMAP, DECISIONS, media, shared UI primitives,
root configuration, or lockfile.

Implementation commits: `8d49887`, `a4bcd6f`, `a05b33c`, `a5218c4`. Final library browser
runs passed on both engines after rebuilding the reader timestamp fix.

## Public behavior and API

- Every user receives private built-in collections 我的书架 (`builtin: shelf`) and 我的收藏
  (`builtin: favourites`). They use ordinary collection membership/sync, are pinned above
  recent documents, and cannot be deleted or shared. No metadata-edit API exists.
- `library.collection.transfer({source,target,doc})` adds a membership from a named,
  authorized source into a writable destination. Repeating a transfer is idempotent.
  `collection.items` only reorders/removes existing members; destination-side additions
  are denied even for the owner. The UI offers transfer on the source document row.
- Text/file imports without an explicit target atomically enter 我的书架. Explicit targets
  receive the first membership without an implicit second membership in the shelf.
  Text/file import permissions are rechecked after asynchronous storage/read work.
  Generated network books retain their transactional publication authorization callback.
- The reader favourite command and 我的收藏 membership are one feature. Its existing LWW
  register is retained as the offline conflict protocol and updated by direct membership
  changes. Optimistic replay updates all scoped collection copies, preserves ordering,
  and the reader advances operations past observed membership timestamps under clock skew.
- Detach, collection deletion, direct document deletion and account purge all reclaim
  zero-container books. Reclamation tombstones sync projections, clears document payload
  and reading state, cancels/clears conversion and source jobs, removes network source
  checkpoints/chapters and collection grants, and releases source/pack references.
  Physical deletion runs immediately after commit through the object publication/GC lock;
  bytes referenced by another book survive. Failed filesystem deletion is reported and
  remains eligible for normal GC. Transaction rollback does not run physical cleanup.

## Proposed decisions for the orchestrator

1. Use physical built-ins with ordinary membership; ordinary collections omit `builtin`.
   Provision before sync snapshots and on default imports, rather than mutate during sync
   provider enumeration. Fresh dev seed accounts are provisioned at application startup.
2. Interpret an explicit delegable source grant as permission to transfer/save to favourites.
   Read/write permission alone does not permit redistribution; the source owner can transfer.
   This reuses the existing grant policy instead of introducing a second permission system.
3. Transfer copies membership and leaves the source intact. An authorized copy/favourite is
   an independent container and retains access after the original grant is revoked.
4. Preserve the queueable favourite wire command and timestamp register as concurrency
   metadata, but remove the separate favourites tab and independent favourite-access model.
5. Keep minimal sync tombstones. Reclaim live state and unreferenced bytes immediately;
   account purge retains its existing policy of deleting the purged user's authored books.
6. No migration/backfill is supplied or needed for this task. Use a fresh development data
   directory when validating; old standalone favourites/uncontained dev books are not migrated.

## Shared/composition changes requiring integrator awareness

- `packages/server/src/kernel/objects/objects.ts` and its test: new targeted `reclaim(ids)`
  shares the existing GC/publication sequencer, bypassing grace only for requested objects.
- `packages/server/src/app/create-application.ts`: seed built-ins and compose reclamation
  hooks for grants/source downloads. `register-api.ts`: provision built-ins before sync.
  `compose-user-purge.ts`: internal purge may delete built-ins.
- `packages/server/src/modules/netbooks/{service,repo}.ts`: narrow deletion hooks remove
  source checkpoints/chapters. Necessary to reclaim dependent state; normal source workflow
  remains covered by unit and browser tests.
- `packages/client/src/features/reader/model/reading-session{,.test}.ts`: favourite clock
  ordering adjustment only. No shared UI or media edits.

## Verification

All gate commands use disk `.tmp` for `TMPDIR`, `TALOS_LARGE_TEST_TMPDIR` and
`TALOS_PACKAGE_E2E_TMPDIR` where relevant, with wall-clock timeouts.

- `pnpm install --frozen-lockfile`: passed, lockfile unchanged.
- `pnpm --filter @talos/client --filter @talos/server --filter @talos/contract typecheck`:
  passed; client typecheck repeated after the reader clock fix.
- Focused `pnpm exec vitest run ... --maxWorkers=3`: **13 files, 121 passed, 1 skipped**.
  Paths: server library, client library, reader `model/reading-session.test.ts`, server
  netbooks, kernel `objects/objects.test.ts`, app `user-purge-atomic.test.ts` and
  `dev-seed.test.ts`. The skipped test is the opt-in live network provider.
- ESLint on changed library/contract/client/reader/server composition/object/netbooks/e2e
  paths and Prettier on all changed code/design documents: passed.
- `node tools/boundaries/ratchet.mjs --check`: passed, zero exceptions/new/stale violations.
- `pnpm --filter @talos/shell --filter @talos/client build`: passed; compatibility scan
  reported zero violations.
- `node tools/e2e/run.mjs library`: passed on current Chromium, including last-container
  UI removal, private built-ins, source transfers, real text/PDF import, 500-page reader,
  grants, offline restart, queued favourite/progress and deletion.
- `node tools/e2e/run.mjs library --legacy`: same scenario passed on real Chromium 70.
- `node tools/e2e/run.mjs netbooks`: passed on current Chromium: search/download, dedupe,
  checkpoint restart, tasks, reader and offline use.
- Inspected the Chromium 70 library screenshot for empty built-ins/pinned entries and
  absent built-in share/delete controls. Screenshots/logs remain ignored under `.tmp`.
- No full `pnpm check`, complete e2e suites, packaging, native Windows run, live network
  provider qualification or legacy-data migration run was performed; these are outside
  the requested focused helper verification.

The first updated current-browser run failed because its picker helper still recognized the
old destination label; the helper was corrected and the scenario passed on both browsers.
Quota meter: 13% before work, 41% after verification (shared account meter).
