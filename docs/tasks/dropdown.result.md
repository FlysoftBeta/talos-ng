# Dropdown / popover / tooltip clipping result

## Implementation and API

- Added `ui/floating`: themed portal layers, pure viewport placement, open-only DOM
  tracking and popup keyboard navigation. No dependency or root configuration changes.
- `SelectField`, `Menu`, `HelpTip`, `IconButton`, `Dialog`, `Sheet` retain their existing
  feature-facing contracts. IconButton additionally accepts a ref and menu ARIA/keyboard
  props. Select arrows now move focus without committing a value; Enter/Space selects.
- Select/menus escape scroll/card clipping; HelpTip and icon hover/focus explanations
  escape clipping. Menus fit both viewport axes, flip, and scroll internally when tall.
- Dialog/sheet portals have their own floating host outside the animated surface but
  inside the accessible dialog/focus boundary. Escape, Tab, Shift+Tab, outside pointer,
  touch and focus work across the portal boundary. Scrolled-out anchors dismiss without
  losing keyboard focus or scrolling the anchor back into view.
- Audited feature menus: sharing, library/reader, media, chat, AI and ops already compose
  Menu/Select and inherit the fix. Removed only netbooks' redundant dialog portal. No
  library/media feature business logic was changed.

## Proposed decisions (integrator assigns D-numbers if needed)

1. Keep floating infrastructure in the presentation layer, with pure geometry separated
   from DOM tracking. Use provider-owned portal hosts rather than a document-global stack
   or a new positioning dependency.
2. Run requestAnimationFrame tracking only while a popup is open. This handles ancestor
   transforms/animations, nested scroll and layout changes on Chrome 70 without depending
   on ResizeObserver; close/unmount cancels the frame and removes listeners.
3. Make the non-transformed modal backdrop the accessible dialog/focus boundary, with the
   animated visual surface and floating host as siblings. Root popups sit below modals;
   each modal's popups remain below later modals. Keep DOM opening order authoritative.
4. Dismiss a popup when its trigger is hidden/removed/fully clipped. Library e2e formerly
   clicked a hidden library toolbar from reader focus mode; it now navigates back until
   the toolbar is visible before opening its menu.

## Verification

Scratch environment: `TMPDIR`, `TALOS_LARGE_TEST_TMPDIR`,
`TALOS_PACKAGE_E2E_TMPDIR` point to this worktree's disk `.tmp` for browser runs.
Commands are bounded with shell `timeout`; no fixed ports or unrelated processes used.

- `pnpm install --frozen-lockfile`: exit 0; lockfile unchanged.
- `pnpm --filter @talos/client typecheck`: exit 0 (production and test configs).
- `pnpm --filter @talos/client lint`: exit 0, including CSS compatibility checks.
- `pnpm --filter @talos/client test`: 74 files / 655 tests passed. Three new geometry
  tests include 3,000 seeded viewport/anchor cases; existing modal interaction tests pass.
- `pnpm --filter @talos/client build`: exit 0; 10 JS/CSS/HTML files, zero compatibility
  violations. `pnpm --filter @talos/shell build`: exit 0 (browser-test prerequisite).
- `node tools/e2e/run.mjs overlays`: exit 0.
- `node tools/e2e/run.mjs overlays --legacy`: exit 0, real Chromium 70.
  Both run 1280×800 light, 768×1024 dark, 320×480 light; page/dialog/sheet cases at
  each size, with ResizeObserver disabled. Assertions cover hit testing outside clipped
  ancestors, viewport bounds, nested-modal stacking/focus, disabled options, long-list
  keyboard scrolling, Escape, Tab/Shift+Tab, outside click, anchor scrolling/dismissal,
  resize and left/right/top/bottom viewport edges. Footer menus verify modal Tab wrapping.
- Browser screenshots under `.tmp/e2e/screenshots/*-overlay-*` are ignored artifacts;
  narrow dialog menus and dark sheet tooltips were visually inspected.
- Changed-file Prettier and e2e ESLint checks pass; `git diff --check` passes.

- `node tools/e2e/run.mjs library netbooks`: exit 0 (current Chromium). Library verifies
  text/PDF imports, the 500-page reader window, grants, offline restart, queued state and
  deletion; the new sharing-picker assertion checks focus, viewport bounds and real hit
  testing below the clipping card. Netbooks verifies search/download/dedupe/checkpoint
  restart/tasks/reader/offline after removal of its redundant portal.
- Visually inspected the actual dark sharing picker and the narrow Chromium 70 Select
  screenshot as well. The list extends beyond the sharing card and remains fully visible.
- Legacy library/netbooks scenarios, the other feature suites, full repository gates and
  packaging were not run in this helper task; the targeted overlay suite is the direct
  Chromium 70 evidence.

## Integration notes

Shared paths changed outside `packages/client`: `docs/impl/design-system.md`, this result,
`tools/e2e/run.mjs` (registers overlays), `tools/e2e/scenarios/overlays/index.mjs`, and
library scenario files (visible navigation plus the actual sharing-picker regression).
No HANDOFF/ROADMAP/DECISIONS edits, root config changes, generated binaries, pushes or
merges. Full repository check/e2e/package gates remain the main orchestrator's work.
