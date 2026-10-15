# 152 — UI redesign: rules for feature-screen helpers

You rebuild one feature's screens on the new design system. The orchestrator (session 9)
designed the system and the app frame and rebuilt chat and the gate screens as the
reference. Your task file (`152<x>-<feature>.md`) says what the feature's UI should be.

## Read first

1. `docs/product/ux.md` — binding interaction and visual design (patterns, states, words).
2. `docs/impl/design-system.md` — tokens, primitives, frame and pane anatomy, CSS rules.
3. `docs/product/<feature>.md` — what the feature does.
4. The reference implementation: `packages/client/src/features/chat/view/*.tsx` and
   `chat.css` (list pane, conversation pane, sheets, dialogs, menus, states).
5. `packages/client/src/ui/` — the primitives you must use (read their props).
6. `docs/impl/e2e-hooks.md` and the feature's scenarios in `tools/e2e/scenarios/<feature>/`.

## What you may change

- The feature's `view/` files (or `view.tsx`) and its stylesheet. Replace the old stylesheet
  completely; prefix classes with the feature (`lib-`, `reader-`, `learn-`, `media-`, `ai-`,
  `admin-`, `ops-`, `settings-`, `tasks-`, `share-`, `netbooks-`).
- The feature's `connect/` files only where a view needs different wiring (keep it thin; no
  logic). Never change `model/` files or behaviour; the props contract stays.
- `packages/client/src/ui/` only to add a genuinely generic primitive or fix a primitive bug;
  keep it presentational, add its CSS next to it, mention it in your report.
- e2e scenarios: only selector updates that follow `docs/impl/e2e-hooks.md` (testids, ARIA
  roles and names). Never weaken an assertion. Keep every `data-testid` hook the views had.

## Rules

- Compose primitives first (`PaneHeader`, `PaneTools`, `PaneBody`, `ListRow`, `Group`,
  `GroupRow`, `Sheet`, `Dialog` with `footer`, `Menu`, `Segmented`, `SearchField`,
  `SelectField`, `Switch`, `Checkbox`, `StatePanel`, `InlineNotice`, `Mark`, `Tag`,
  `Avatar`, `EmptyPane`, `Progress`, `Button`/`IconButton` with `disabledReason`).
  Feature CSS only for what is unique to the feature.
- Colours only through the CSS variables of `tokens.ts`; sizes from the scale in
  `base.css` (`--s-*`, `--fs-*`, `--control`, `--header`, `--gutter`, `--gutter-content`).
  No inline styles except computed values (widths, transforms).
- Chrome 70: no flex `gap` (use margins / `> * + *` / `grid-gap` on grids), no `inset`,
  `aspect-ratio`, `clamp/min/max()`, `:is/:where/:has/:focus-visible`,
  `overflow-wrap: anywhere`, no optional chaining in emitted JS (TS handles it).
- One primary button per surface; dialog actions in `footer` (cancel then primary);
  destructive actions confirm via `ConfirmDialog` naming the object; secondary row actions
  in a trailing `Menu`; at most three header icon actions, the rest in a ⋯ `Menu`.
- Empty content pane: `EmptyPane` (faint icon + one short hint, no title, no actions).
- Remove the old unicode glyph icons (✎ ↩ ◆ ⛶ …); use `Icon` names from
  `ui/icon/glyphs.ts` (add Lucide glyphs there only if needed, via the same data format).
- Text: Simplified Chinese, short, verbs on buttons, no blame.

## Verify (all required, in this order)

1. `cd packages/client && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.test.json --noEmit && pnpm lint`
   and `npx prettier --write` on changed files.
2. `TMPDIR=$PWD/.tmp pnpm --filter @talos/client build` then
   `TMPDIR=$PWD/.tmp node tools/e2e/run.mjs <feature>` from the repo root; it must pass.
3. Open the fresh screenshots in `.tmp/e2e/screenshots/current-<feature>-*` with the Read
   tool — both sizes (1280×800, 768×1024), light and dark, every state captured — and fix
   what is ugly: misalignment, inconsistent margins, stray borders, odd gaps, overflow,
   clipped text, weak hierarchy, cramped touch targets. Iterate until clean.
4. `TMPDIR=$PWD/.tmp npx vitest run packages/client/src/features/<feature>` passes.

Commit after each coherent step on `main` (you work directly in the main tree; the
orchestrator is idle while you run). Message ends with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, never edit
`docs/tasks/HANDOFF.md`, never touch other features' views.

## Report (final message, ≤ 25 lines)

What you rebuilt, primitives added or changed, e2e result, which screenshots you reviewed and
what you fixed after looking, scenario selectors changed, anything left unpolished.
