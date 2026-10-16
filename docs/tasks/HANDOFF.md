# Initial-login cursor repair — 2026-10-16

- Deployed build `16810b2` failed first paginated sync when a scope had a cached cursor but was
  not admitted to the current user. The request started at zero; apply incorrectly used
  the other cached cursor. Reproduced the exact PIN-screen error in real Chromium 70
  using the old production code before changing the browser assertion.
- New admission replaces inherited rows/windows using a full snapshot. Atomic apply
  detects request-base changes from other tabs or cache eviction, retries twice immediately
  then backs off. Invalidated scopes must repull before accepting deltas; truly backwards
  response chains remain rejected. Progress resets per attempt (D-118).
- Five new engine regressions cover new admission, another tab, eviction during a pull,
  eviction before a delta, and invalid server chains. Full tests: 177 files, 1,840 passed,
  one optional test skipped. Typechecks, lint and build/static compatibility pass.
- Real-browser hardening now seeds an unadmitted cached cursor, requires pagination,
  and verifies all 250 settings persist before login completes. It fails on old code with
  `Pull cursor moved backwards` and passes on the repaired Chromium 70 build.
- Three-target package, full modern browser and full real Chromium 70 suites pass,
  including the new login regression, performance budgets and packaged update/rollback,
  SQLite/object restore and HTTPS/WSS. Existing browser data is repaired through sync;
  no reset or migration is needed.
- Owner changed verification workflow after these runs: push first and monitor CI by
  default; no mandatory full local checks. Use targeted local checks only when useful for
  quick feedback (D-119; AGENTS.md, CHARTER.md and _common.md updated).

# Sync recovery and personal offline retention — 2026-10-16

- Fixed oversized legal sync revisions with bounded continuation transfers, recovery after
  lost/oversized push, and serialized pull/delta application. Retries preserve acknowledged
  writes, isolate object queues, honor text-upload dependencies, and fence old sessions.
  Revoked-scope cache cleanup persists until completed; re-grants cancel stale cleanup.
- Books, songs, booklists and playlists have independent per-user offline policies on the
  personal sync scope (D-116/117). Own active policies combine by longest deadline;
  shared collection settings cannot force another user's downloads. Access and membership
  changes stop retention. Prior policy configuration is discarded; only initial schema
  and the legacy importer changed, with no current-app schema migration.
- File downloads fence user changes, classify HTTP errors, resume partial ranges and time
  out after 30 seconds without progress. Idempotent logout replay cannot revoke a newer
  login token. Regression coverage includes these error, retry and isolation paths.
- Integrated `pnpm check`: exit 0, 177 files, 1,835 passed and one optional test skipped;
  all build/static compatibility checks pass. Three-target `pnpm package` exits 0.
- `pnpm e2e:legacy` exits 0 on actual Chromium 70, with all feature suites.
- `pnpm e2e` exits 0, including performance budgets and packaged Linux A → B →
  broken-C rollback, WELCOME/SW installation, SQLite/object restore and HTTPS/WSS.
  Native Windows execution remains unverified. This host required the bundled PDF
  renderer's libjpeg.so.8 dependency via a local test-only library path.
- Browser tests explicitly await personal collection policy acceptance before deleting
  its target and clear only the unretained fixture PDF before asserting offline absence;
  viewing or temporary collection retention may otherwise cache the entire small pack.

# CI check repair — 2026-10-15

- GitHub run 38755754989 failed on client test-only Array.at typings. The integrated
  ES2022 test configuration fixes this while production remains independently checked
  against ES2018. Source-entrypoint failures from run 38753096704 are covered by the
  tsx changes and passing migration/boot tests.
- The same earlier CI run timed out in IntervalSet's 8,000-step model test. Gap probes
  now compare arrays once per iteration, preserving all operations and membership checks
  while reducing matcher overhead; no timeout increase or coverage reduction.
- Final main `pnpm check` exits 0: 175 files, 1,774 tests passed, one skipped, static
  compatibility scans clean. This follow-up changes only tests and documentation.
  Verified the existing full `pnpm e2e`, `pnpm e2e:legacy`, and three-target `pnpm package`
  logs for production code at 73b7c61; production sources and gate tools are unchanged.
- Codex shared quota: 56% consumed; no reset used.

# Source containers and floating controls — 2026-10-15

- Fixed clipped selects, menus and tooltips with themed portal layers and modal-owned
  floating hosts, including viewport placement, scrolling and keyboard focus (D-113).
- Added protected private 我的书架 / 我的收藏, pinned atop recent reading; favorites
  use booklist membership. Source-side transfer requires source redistribution permission;
  destination-side add controls are removed. Imports default to the shelf. Zero-container
  books and dependent state/jobs/unreferenced objects are reclaimed immediately (D-114).
- Music saving uses search or accessible playlists, without a transfer flag or global
  catalog. Zero-reference songs are reclaimed after a durable grace period; audio cache
  eviction is separate. Both periods are independent fixed 30-day constants in
  `packages/server/src/modules/media/retention-policy.ts`; administrator configuration
  was removed (D-115).
- Fresh development database required; no migration supplied. Existing `.data/talos.db`
  is open in a pre-existing development server and was not modified/reset while in use.
  Stop that server and reset its dev data before starting the updated code.
- Integrated `pnpm check`: exit 0, 175 files / 1,774 tests passed, 1 optional live-provider
  test skipped; build/static compatibility scan passed. `pnpm e2e` and `pnpm e2e:legacy`
  both exit 0 on final code `73b7c61`; current e2e includes packaged Linux A → B → broken-C
  rollback, database/object restore and HTTPS/WSS. `pnpm package` exits 0 for win32-x64,
  linux-debian-x64 and linux-redhat-x64. Native Windows execution remains unverified.
- Global playback overlays are inside the themed portal provider; the redundant player
  portal was removed. Browser helpers reveal scrolled controls before opening menus.
- Node test typechecking uses ES2022 declarations; browser production remains ES2018.
  Contract compatibility covers source transfer, and importer verification excludes
  built-in booklists from imported-source counts.
- Completed task material is archived locally. Codex shared quota was 45% after helpers.

# Source TypeScript entrypoints — 2026-10-15

- Removed experimental transform flag from scripts, subprocesses and instructions.
  Source import graphs containing parameter properties now use the existing tsx
  4.23.15 loader; migration registers it in-process instead of restarting itself.
- Main at 518430f: frozen install and unmodified pnpm build exit 0 on Node 24.18.0;
  static client compatibility checks report 0 violations. No separate tests/e2e/package
  gates per user request. Live startup, migration data processing and packaging remain
  unverified for this change. See D-114.

# Node 24 alignment — 2026-10-15

- Host is Node 24.18.0; workspace requires ^24.18.0. Packaged runtime and CI pin
  24.22.0; direct @types/node is 24.19.2. Server/launcher/migration target node24.
- Main at 6d0e151: frozen install and unmodified pnpm build passed on Node 24.18.0.
  No separate tests/e2e/package run, per user instruction. Packaged 24.22.0 runtime
  and native Windows execution remain unverified. D-113 supersedes D-112's Node pins.

# Dependency refresh — 2026-10-15

- Updated workspace dependencies/lockfile, CI actions, bundled Node to 24.22.0,
  and yt-dlp to 2026.08.19 with official Linux/Windows SHA-256 values.
- Removed forced `youtube:player_client=web_music`; upstream defaults now apply.
- Retained Zod 3 for contract/Chrome 70 compatibility, Node 24 declarations for the
  supported runtime baseline, dual TypeScript compiler roles, fixed Chrome 70
  fixture and vendored pdfrender provenance (D-112).
- Verified on main at 9fc3b6b: `pnpm install --frozen-lockfile` and unmodified
  `pnpm build` exit 0. Build includes its existing typechecks and static compatibility
  checks (0 violations). No separate test/e2e/package gates per user instruction.
- Node 24.22.0 packaged native loading, real Chrome 70 and live yt-dlp behavior were not
  exercised in this update. Prior verification below predates these dependency changes.

# Handoff

## LIVE LOG — session 9 (UI/UX redesign, Claude-led)

Resume here if the session was cut off. Design: `docs/product/ux.md` (product intent),
`docs/impl/design-system.md` (implementation). Screenshot loop: build the client, then a
Playwright script against `createRealServer()` (see the design-system doc, "Verifying").

- [x] 1. Design system foundation: MUI/Emotion removed; tokens (`ui/theme/tokens.ts` +
  `base.css`), Lucide glyphs, Button/IconButton/Menu/Toast/ListRow/StatePanel/Sheet/Dialog/
  Field/Select/Switch/Composer/DataGrid restyled, app frame (rail, list kinds, focus mode,
  stacked back). Old `ui.css` deleted; transitional colour aliases at the end of `base.css`.
- [x] 2. Chat rebuilt (rows not bubbles, floating post toolbar, settings sheet with switches,
  menus) and gate screens (centred card, PIN pad). chat e2e green; scenario selectors updated
  (menuitem, switch, reply-jump label).
- [x] Owner cleanup: finished process docs archived to git-ignored `archive/` (499487a),
  `pnpm check` green.
- [ ] 3. Remaining features via sequential helpers with specs `docs/tasks/152*.md`:
  - [x] 152a library/reader/netbooks/sharing (401edac, 63c0097; library+netbooks e2e green,
    reviewed). Known: PDF page gap 24 px (model estimate), legacy run pending.
  - [x] e2e captures settle animations (harness STILL_MOTION init script).
  - [x] 152b learning (f78a8b0..e8ae1b7; identity e2e green, reviewed; harness root-wait fix)
  - [x] 152c media · [x] 152d AI · [x] 152e settings/tasks · [x] 152f admin/ops (merged, session 10)
- [x] 4. Full review (gates green on main: check, e2e, e2e:legacy, package) (both sizes/themes, legacy Chromium 70), gates, ui-final screenshots.

Current state of `talos-ng`, written by orchestrator session 8 (2026-10-14). Entry point is
`/AGENTS.md`; charter `docs/tasks/CHARTER.md` (owner feedback of session 4 at its bottom
re-scoped the project). History of earlier sessions is in git and in the task files
`docs/tasks/<id>-*.md`; this file only states what is true now.

## Next: the UI redesign session

Everything the owner ordered before it is done: core functionality, package targets,
code organisation (147/149), test-suite review (150), docs reorganisation (151). The next
session is the **Claude-led UI/UX redesign from first principles** (owner item 1). The
project is not DONE before it. Inputs:

- `docs/product/` — the product as it is (features per area, roles, offline rules) and
  `docs/product/ux.md` — UX requirements (state always visible, offline/syncing, compact
  tablet layout, disabled controls give their reason). Requirements, not current visuals.
- `docs/impl/client-runtime.md`, `docs/impl/client-features.md` — client model / connect /
  view split; the redesign replaces views and presentation, controllers stay.
- `docs/impl/e2e-hooks.md` — the semantic e2e selector contract (`data-testid`
  `<area>.<thing>` or ARIA). New views must keep the hooks or update the scenarios under
  `tools/e2e/scenarios/<feature>`.
- Hard constraints still bind the new UI: Chrome 70 (`pnpm e2e:legacy` drives real Chromium
  70), no flex `gap`/`inset`/`aspect-ratio`, IndexedDB without Blobs.

## State of `main`

- All feature milestones M0–M19 merged (`docs/tasks/ROADMAP.md`). Completeness inventory
  `docs/tasks/COMPLETENESS.md`: 144 F-ids, no partial/missing.
- Structure: boundaries enforced by `tools/boundaries/` (ratchet exception list empty).
- Tests after 150: 172 files, 1,740 tests + 1 skipped in `pnpm check` (was 1,620 + 1 before
  150); front-end e2e per complex feature, API availability tests for simple ones.
- Docs after 151: `docs/tasks/` process, `docs/product/` product design, `docs/impl/`
  implementation design (`docs/impl/README.md` index). `docs/ARCHITECTURE.md`,
  `ORCHESTRATION.md` (→ `docs/tasks/CHARTER.md`) and `POLISH.md` no longer exist.
- e2e screenshots and measurements are ignored artifacts under `.tmp/e2e`; no generated
  binaries are tracked. Git history still contains ~540 MiB of old screenshot PNGs; whether
  to rewrite history is the top level's decision (not done).
- Remote: `origin` = https://github.com/FlysoftBeta/talos-ng.git. Rule: push `main` after
  each completed unit once gates are green (orchestrator only).

## Verified by the orchestrator (session 8)

- `main` = 9c32c44 (end of 150): `pnpm check` 0 (1,740 + 1 skipped), `pnpm e2e` 0,
  `pnpm e2e:legacy` 0, `pnpm package` 0, tree clean after.
- Final gates: see "Final gates" below.

## Open / known gaps

- Test review leftovers: no front-end e2e for task retry/cancel; client lifecycle multi-tab
  reset and admin sub-controllers only thinly tested.
- **Native Windows** never run (Wine 11 smoke only); Office COM capture, console-close,
  Windows power-loss durability of bulk ingest unverified.
- `linux-debian-x64` artefact structurally checked only (host is Fedora).
- Live external providers (yt-dlp, AI upstream, tomato novels) covered by fakes only.
- Migration of real PDFs, images, media and AI data verified on synthetic fixtures only;
  larger legacy DBs under `classapp-next/worktree/mydbs/` not inspected.
- Performance numbers are from throttled current Chromium, not real tablets.
- Native addons (better-sqlite3, sharp; D-111): win32 artifact verified only by a Wine smoke of the bundled binaries, not on native Windows; BMP support is limited to uncompressed 8/24/32-bit.
- pdfrender source build: decided not to act for now (see the Linux-targets decision in DECISIONS.md).
- Migration rehearsal: `verify` exits 1 for 10 ownership-fallback issues (group-only
  collections need an earliest-imported-user fallback owner) — review before cutover; real
  PDFs, post images, media/AI history and legacy-PIN login on real data unverified.
- Security: in-memory request budgets reset on server restart (accepted operational risk;
  PIN throttles are durable).
- Platform: backup/restore rename paths lack the launcher's transient-lock (EBUSY/EPERM)
  retry; native Windows antivirus locking, long paths and console-close unverified.
- Offline: no exhaustive proof that every request is intercepted while offline (manifest
  refresh/reconnect attempts may still touch the network); static compat scanning is
  heuristic, real Chromium 70 runs remain the evidence.

## Budget

Codex meter ≈ 85 % of the weekly window; no Codex dispatch since session 5. Sessions 5–8
ran everything Claude-side (one Sonnet helper at a time). No usage reset is available.

## Session 8 log

- Gates on 9c32c44 green (above). 151 docs reorg in three Sonnet runs (process moves →
  `docs/impl` → `docs/product`), merged as cb31b25; charter/AGENTS.md push rule updated;
  AGENTS.md forbids committing generated binaries.

## Final gates

Run by the orchestrator on `main` = cb31b25 (merge of 151, the last commit that changes
anything but this file and the roadmap row), scratch on disk, tree clean before and after:
`pnpm check` 0 (172 files, 1,740 tests + 1 skipped), `pnpm e2e` 0 (incl. packaged Linux
A → B → broken-C rollback), `pnpm e2e:legacy` 0 (Chromium 70), `pnpm package` 0 (win32-x64,
linux-debian-x64, linux-redhat-x64). The commit adding this file was checked with Prettier.
