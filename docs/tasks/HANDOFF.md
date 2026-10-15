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
