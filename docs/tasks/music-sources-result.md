# Music sources — implementation result

Implemented on `m/music-sources`. The owner's delayed-reclamation clarification is the
final specification. No built-in music collection is created; the rejected automatic
search collection and immediate song cleanup are absent from the final implementation.

## Proposed decisions for the integrator

- Only explicit playlist membership retains a song. Search persists bounded metadata and
  per-user discovery authorization without a playlist or cumulative 500-track cap.
  Favourites, recents, queues, repeated searches and playback never extend retention.
- Reuse the existing administrator `evictionDays` setting (default 30 days) for the
  unreferenced-song grace period as well as the existing independent audio-cache eviction.
  Durable `unreferenced_since` starts at initial unreferenced ingestion or the final playlist
  removal. Reattachment clears it. A later final removal starts a fresh period.
- Existing scheduled maintenance reclaims when `unreferenced_since <= now - days * 86400000`.
  Until that pass runs, eligible songs still exist. Each reclamation transaction handles at
  most 100 tracks, releasing object references, tombstoning discoveries and pruning personal
  state together. Physical object deletion follows the object ledger's normal sweep.
- Persist an incarnation generation with tracks and materialisation jobs. A delayed job may
  not publish after reclamation, even when another search has revived the same provider ID.
  Rediscovery restores only that searcher's authorization, never old discoverers' access.
- Remove music delegation flags. An accessible playlist allows copying into a writable
  destination and sharing at the holder's grant level or below. Existing stronger-grant,
  owner-protection and own-authority revocation rules remain enforced.
- No new built-ins: users explicitly save from current search results or one accessible
  playlist. Public provider-ID resolve reads existing authorized tracks only. No global
  catalog is exposed by library snapshots, sync or the add-song picker.

## API and implementation

- `media.playlist.share` no longer accepts `delegate`; `media.playlist.grants` no longer
  returns it. The music-specific sharing sheet has no transfer setting; shared UI/library
  implementations were not changed.
- `media.track.resolve` cannot ingest a guessed provider ID. Search, play, prepare,
  favourites, queues and playlist copy continue through current per-user source access.
- Trusted `MediaService.importTrack(value, lastPlayed?, playlist?)` optionally assigns its
  playlist atomically. Untargeted offline import metadata receives the same durable grace
  clock while its playlists are assembled. Failed target writes roll back the track too.
- Fresh schema/dev reset required. No upgrade migration for existing media schemas was
  requested or added. Existing migration gates remain coherent; this is not a data migration
  project.

## Verification

Commands ran in this worktree. Gates used disk scratch through `TMPDIR`,
`TALOS_LARGE_TEST_TMPDIR` and `TALOS_PACKAGE_E2E_TMPDIR` set to `$PWD/.tmp`.

- `pnpm install --frozen-lockfile` — exit 0, unchanged lockfile.
- `pnpm exec vitest run packages/server/src/modules/media packages/server/src/app/user-purge-atomic.test.ts packages/client/src/features/media tools/migrate/src/migrate.test.ts --maxWorkers=2`
  — exit 0, **9 files / 92 tests passed** (73 media/client/purge tests plus 19 importer tests).
- `pnpm --filter @talos/contract --filter @talos/server --filter @talos/client --filter @talos/migrate typecheck`
  — exit 0; server typecheck rerun after the last test addition.
- `pnpm --filter @talos/contract --filter @talos/server --filter @talos/client --filter @talos/migrate lint`
  — exit 0, including the client's CSS compatibility check.
- `node tools/boundaries/ratchet.mjs --check` — exit 0.
- `pnpm --filter @talos/contract --filter @talos/shell --filter @talos/client --filter @talos/server build`
  — exit 0, including contract/browser compatibility checks and zero static Chrome 70 violations.
- `node tools/e2e/run.mjs media` — exit 0, current Chromium.
- `node tools/e2e/run.mjs media --legacy` — exit 0, real Chromium 70.
- Prettier check over changed code/docs and `git diff --check` — exit 0.

Regressions cover unrelated private tracks (including root), guessed provider IDs,
read-only source copying, grant/membership loss, discovery rollback, more than 500 search
results, paginated tombstones, exact grace boundaries, non-extending personal actions,
reattachment, multiple playlist references, durable restart, user purge, configured scheduled
maintenance, stale materialisation with and without rediscovery, atomic target ingestion,
expired picker results, offline playback and revocation. No live yt-dlp or native Windows run.
Full `pnpm check`, full feature e2e and packaging remain the orchestrator's integration gates.

## Shared files and integration

Outside media-owned source directories: `packages/contract/compat.mjs` updates the protocol
fixture; `packages/server/src/app/user-purge-atomic.test.ts` removes the obsolete media
transfer-table seed; `tools/migrate/src/target/sharing.ts` removes the obsolete media
transfer write/warning while leaving library policy unchanged. The media e2e scenario and
media sections of product/implementation docs were updated. No root configuration,
HANDOFF, ROADMAP, DECISIONS, library source or shared UI primitives changed.

The quota meter reported 13% before work and 37% after (shared account, not task-exclusive).
No helpers spawned, no merge, no push.
