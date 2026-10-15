# Design system

How the interface described in `docs/product/ux.md` is built. Code: `packages/client/src/ui/`
(presentational, props in / callbacks out, no runtime imports) and the frame in
`packages/client/src/app/frame.tsx`. There is no UI framework: React plus plain CSS with
custom properties. MUI and Emotion were removed; nothing generates CSS at run time.

## Tokens

- `ui/theme/tokens.ts` is the source of the **colour roles** for light and dark.
  `TalosProvider` writes them as CSS custom properties on the `.talos` root (`--bg`,
  `--sidebar`, `--raised`, `--hover`, `--selected`, `--border`, `--border-strong`, `--text`,
  `--muted`, `--faint`, `--accent`, `--accent-hover`, `--accent-ink`, `--accent-soft`,
  `--pending[-soft]`, `--failed[-soft]`, `--confirmed[-soft]`, `--inverse[-ink]`, `--scrim`,
  `--shadow`). A unit test checks AA contrast of every ink role on every background role.
- `ui/theme/base.css` mirrors the **size, type and motion** tokens (CSS cannot import TS):
  type `--fs-1..6` / `--lh-1..6` (12/16, 13/18, 14/20, 16/24, 20/28, 28/36) and `--lh-read`;
  space `--s-1..7` (4, 8, 12, 16, 24, 32, 48); `--rail` 64, `--list` 296/264, `--nav` 216/184,
  `--header` 56, `--control` 40, `--control-sm` 32, `--row` 44, `--row-2` 56, `--gutter` 16,
  `--gutter-content` 24/16, `--radius` 8, `--radius-lg` 12, `--fast`/`--normal`/`--ease`.
  Below 1100 px the list widths and content gutter shrink; `.text-large` raises the text steps.
- Rules for every stylesheet: colours only through roles (no hex in feature CSS), sizes
  from the scale (odd values need a comment), no shadows except overlays, no borders inside
  grouped surfaces except the hairline between rows.

## Chrome 70

No flex `gap` (use the `.stack-N` / `.inline` / `.actions` margin helpers or `> * + *`
margins), no `inset`, `aspect-ratio`, `clamp()/min()/max()`, `:is/:where/:has`,
`:focus-visible`, `overflow-wrap: anywhere`. Grid layouts may use `grid-gap`, which
Chrome 70 supports. `scripts/css-check.mjs` lints every `.css` file under `src/` in
`pnpm lint`; the compat gate checks the built bundle. Keyboard focus rings come from
`data-focus="keyboard"` on the root (input-modality heuristic) instead of `:focus-visible`.

## Primitives (`ui/`)

| Module | Components | Use |
|---|---|---|
| `layout` | `AppFrame`, `PaneHeader`, `PaneTools`, `PaneBody`, `Pane`, `Stack`, `Inline`, `Group`, `GroupRow`, `SectionHeader`, `KeyValue`, `Tag`, `Avatar`, `EmptyPane` | frame and pane anatomy; grouped settings-style lists; record details |
| `actions` | `Button` (primary, secondary, ghost, danger, danger-ghost; small; `icon`; `disabledReason`; `busy`), `IconButton` (`pressed`, `badge`, `disabledReason`), `GridAction` | one primary per surface; icon buttons always labelled |
| `feedback` | `ListRow`, `Mark`, `Badge`, `StatePanel`, `Spinner`, `Progress`, `InlineNotice`, `BannerHost`, `OfflineHint`, `HelpTip`, `useToast`/`ToastHost`, `StatusPill`, `StatusCenter` | rows, the five states, operation marks, disabled reasons |
| `overlays` | `Sheet`, `Dialog` (`size` sm/md/lg/xl, `footer`, `actions`, `subtitle`), `DialogActions`, `ConfirmDialog`, `Menu` | side panels, centred dialogs, row and overflow menus |
| `inputs` | `Field` (checkbox renders `Checkbox`), `TextArea`, `SearchField`, `Checkbox`, `Switch`, `SelectField` (custom listbox picker, `hideLabel`), `FileButton`, `FileField`, `DurationInput`, `SharedComposer` | forms; no native select |
| `navigation` | `Rail`, `RailItem`, `RailSpacer`, `Segmented` (`block`), `Tabs` | area switch; two-to-five-way choices; pane views |
| `data-grid` | `DataGrid`, `SelectionActionBar` | admin tables (virtualised rows, server paging) |
| `virtual` | `VirtualScroller`, `useArrayScroller` | bindings for `@talos/virtual` (chat, AI, reader, stickers, grids; see `virtual-scroller.md`) |
| `icon` | `Icon` + `glyphs.ts` | Lucide glyphs (ISC) vendored as path data; add names to `glyphs.ts` |

Disabled-with-reason: `Button`/`IconButton`/`RailItem`/`Menu` items take `disabledReason`;
the control keeps `aria-disabled`, looks disabled and shows the reason as a toast when
touched. `OfflineHint` wraps composite controls the same way.

## Frame and panes

`AppFrame` renders rail · list · content. Props: `listKind` (`collection` 296/264 px or
`nav` 216/184 px), `focus` (hide the list pane: open document, practice round), `detail`
(a narrow window shows content instead of the list), `onBack`. `PaneHeader` inside the
content pane renders the back control (`ui.frame.back`) when the frame is in focus or
stacked mode, or when the caller passes `onBack`. The frame derives `focus`/`detail` from
the navigation stack in `app/frame.tsx`; features never measure the window.

Anatomy of a pane, top to bottom: `PaneHeader` (56 px, title, ≤3 icon actions, ⋯ `Menu`),
optional `PaneTools` (search or `Segmented`), `PaneBody` (scrolls; `padded` applies the
gutter; `narrow` caps the column at 720 px for forms and reading), optional footer
(`.pane-footer`: composer, player). List panes put rows straight into the body; rows are
inset 8 px and rounded, no dividers.

## Feature stylesheets

Each feature keeps one stylesheet next to its views (`features/<f>/view/<f>.css`), classes
prefixed with the feature (`chat-`, `lib-`, `reader-`, `learn-`, `media-`, `ai-`, `admin-`,
`ops-`, `auth-`, `settings-`, `tasks-`). A feature stylesheet styles only what is unique to
the feature (post rows, the player, the PIN pad); anything a second feature would need moves
into `ui/`. Views compose primitives first and add classes second.

## Verifying

Screens are reviewed from real screenshots at 1280×800 and 768×1024, light and dark,
including empty, loading, error and offline states: the e2e scenarios write captures to
`.tmp/e2e/screenshots` (`node tools/e2e/run.mjs <feature> [--legacy]` after building the
client), and a quick Playwright script against `createRealServer()` from
`tools/e2e/harness/real-server.mjs` (seeded root PIN `123456`, reveal with the arrow-key
sequence) can capture any state while iterating. Chromium 70 rendering is checked with
`--legacy`.

## Administration and operations panes

Administration uses the shared pane header and a padded, flexible table body. A DataGrid
with `height="fill"` measures the available row viewport after subtracting its tools,
header and pager. It remeasures after renders and window resizes on Chrome 70, and observes
container resizing where ResizeObserver is available. Numeric heights remain supported for
bounded tables inside sheets. Empty states occupy the same body and keep paging at the bottom.

Record editors use sheets with sticky action footers; bulk reports retain a result mark for
every target. System policies use grouped switches. Operations panels own their header and
scrolling grouped body, including when embedded in the administration frame or gallery.
