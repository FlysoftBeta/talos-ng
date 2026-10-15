# 153 — Finish the id-based virtual scroller (verify, fix, integrate, document)

Branch `m/virtual-scroller`, worktree `../talos-ng-wt/virtual-scroller`. Commit after every
step. Do not merge or push. Do not edit HANDOFF.md / ROADMAP.md.

## Goal (owner request, verbatim intent)

A standalone virtual-scrolling library replacing the old `VirtualList`, used by every long
content view (chat messages, sticker panel, AI transcript, reader for PDF and text, data
grid, dev showcase):

1. Dynamic item sizes. The top of the first item in the viewport keeps its on-screen
   position; when an item expands/collapses (also animated), only items below it move.
   Rendering covers more than the viewport (overscan) so no blank bands appear.
2. Id-based item tracking. The data source owns items; it answers fetches (scrolling to an
   edge, jumping to an id) and may push changes itself. All source traffic is one ordered
   stream.
3. Opening at any id (or source-defined key, e.g. a seq) without index search.
4. Loading in both directions.
5. Rendered items ≠ viewport items.
6. Tests: browser-behaviour tests (real scrolling over CDP, checking on-screen positions
   for visible jumps), extensive state-machine tests, e2e.

## What exists (commit 870f8ff, read the code first)

- `packages/virtual` (`@talos/virtual`): `src/core/protocol.ts` (Source/Request/
  SourceEvent), `src/core/sizes.ts` (Fenwick), `src/core/scroller.ts` (the `Scroller` state
  machine: anchors item/end/edge/align, seek/extend tokens, trimming, stick-to-end with gap),
  `src/sources/array.ts` (`ArraySource`: diffing, `load`/`prepare`/`locate` hooks),
  `src/dom/driver.ts` (`DomViewport`: measuring, ResizeObserver + fallback, user scroll as a
  delta, render deferral inside observer callbacks to avoid RO loop errors).
  Tests: `scroller.test.ts` (scenarios) and `scroller.model.test.ts` (seeded randomised model
  test; `VIRTUAL_BLOCKS=100` runs 5000 seeds — was green, ~90 s; `VIRTUAL_SEED`/
  `VIRTUAL_TRACE` replay one seed).
- Boundaries: graph entry `virtual`, `tools/boundaries/policy/virtual.mjs`, subpath
  `@talos/virtual/dom` allowed in `graph.mjs`.
- Client: `ui/virtual/virtual-scroller.tsx` (`VirtualScroller`), `use-array-scroller.ts`;
  chat (`features/chat/model/history.ts`, `ConversationController.history`), sticker picker,
  AI (`ConversationController.transcript`), reader (`features/reader/view/viewer.tsx`),
  data grid, showcase. `pnpm --filter @talos/client test` and both packages' typecheck/lint
  were green at 870f8ff.
- Browser bench: `packages/client/src/dev/virtual-bench.tsx` (gallery `?virtual`,
  `&end`), e2e feature `tools/e2e/scenarios/virtual` (added to `run.mjs` ORDER).

## Steps

1. Bench suite: its helpers measure from the list's border edge; the list has a 1 px border,
   so measure relative to `getBoundingClientRect().top + clientTop` (first failure was
   "opens on its target 1 !== 0"). Then make `node tools/e2e/run.mjs virtual` pass on
   current Chromium AND `--legacy` (real Chromium 70). If CDP wheel deltas do not map 1:1 to
   px on an engine, derive the expected move from an independent source (never from the
   scroller's own bookkeeping) and say so in a comment. Fix real defects in the scroller or
   driver rather than loosening assertions; any loosened tolerance needs a stated reason.
   Add a scenario for touch/drag scrolling (`Input.dispatchTouchEvent`) and for scrolling
   while an item animates, both checking per-frame on-screen positions.
2. Run and fix the existing feature e2e touched by the change, current and legacy:
   `chat`, `library` (reader), `ai`, `admin` (grid), `hardening` (scroll long-task budgets,
   reader anchor), `offline` (smoke uses `data-virtual-index` on the showcase list; the new
   binding renders `data-virtual-id` = window id; showcase ids are the row number). AI e2e
   counts rendered `ai.message` elements — virtualised now; adjust scenario selectors only
   where virtualisation legitimately hides off-screen items. Keep semantic selectors
   (`docs/impl/e2e-hooks.md`).
3. Check the integrations behave: chat opens at the first unread post (or end), pages
   older/newer posts at the ends (offline ends show a reason, retry when online), reply jump
   pages back to uncached posts, "跳到最新消息" works, new posts are followed at the end;
   AI follows a streaming answer, pages earlier messages at the top; reader restores the
   exact position (char offset for text), zoom keeps relative position, page input jumps;
   sticker packs; grid paging.
4. Docs: `docs/impl/virtual-scroller.md` (mechanism: protocol, anchor rules, stick-to-end,
   tokens/ordering, trimming, DOM driver and the RO deferral, testing approach), link it in
   `docs/impl/README.md`; update `structure.md` (package graph), `design-system.md`,
   `documents.md`, `client-runtime.md`, `e2e-hooks.md`, and the e2e README feature list.
   Short `packages/virtual/README.md` (only what code/docs do not say). Propose a decision
   entry text in your result file (the orchestrator numbers it).
5. Gates in the worktree: `pnpm check`, `pnpm e2e`, `pnpm e2e:legacy`, `pnpm package`; tree
   clean afterwards. Point TMPDIR, TALOS_LARGE_TEST_TMPDIR and TALOS_PACKAGE_E2E_TMPDIR at
   `$PWD/.tmp`.

## Constraints

Chrome 70 (no flex gap/inset/aspect-ratio, no RO-only paths), IndexedDB without Blobs,
code-organisation and test rules of AGENTS.md (no grab-bag modules, no trivial tests).

## Result

Write `docs/tasks/153-virtual-scroller.result.md`: what changed, defects found and fixed,
gate outputs (commands + exit codes), what is unverified.
