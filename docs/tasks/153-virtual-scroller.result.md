# 153 — Virtual scroller completion result

## Changes and defects

- Kept the id-based `Scroller<T, L>` / `Source<T, L>` protocol and the `ArraySource`
  adapter. Seek and extension replies remain tokened and share the ordered push stream.
  Source request exceptions now enter the retryable failure path; invalid duplicate keys
  use `AppError(E_INVALID)` and a non-progressing extension uses `E_PROTOCOL`.
- Corrected the DOM driver: Chrome 70 cancels a smooth wheel gesture when anchoring writes
  `scrollTop` during it. The driver temporarily translates layers by the correction and
  rebases after native scrolling settles. Touch uses the same mechanism. Idle timers are
  injectable and disposed with the viewport.
- Resize and hidden-pane native offset clamping no longer masquerades as user scrolling
  and drops end following. Added a per-frame / mutation measurement fallback for browsers
  without ResizeObserver, preserving the existing observer render deferral.
- An empty source gaining a remote end now seeks again: there is no boundary id to extend.
  This fixes the first remotely sent post in an already open empty chat.
- Chat read markers exclude optimistic posts. Their provisional seq could exceed the
  server's latest seq, creating a failed queued read and blocking subsequent sends.
  Opening also completes from local rows if connectivity disappears during initial sync.
- Reader text resume stores optional `charInset` with its UTF-16 character offset. It
  restores the character at its prior screen coordinate, retaining partial lines exactly.
  PDF restore no longer leaves a text-restoration flag that disables relative zoom;
  page input and its displayed value now track programmatic jumps.
- AI e2e waits identify the new assistant reply by `data-message-id`; offline verification
  scrolls to the earlier rich reply. The showcase smoke uses `data-virtual-id` row ids.
- Browser bench measures inside the 1 px border, renders edge slots only while more exists,
  calibrates wheel input using an independent plain native scroll box, and samples actual
  rectangles during touch drag, wheel plus animation, end following and the no-RO path.
  Bench animations change DOM size without React commits, exercising the driver itself.
  Browser errors (including observer loops) fail the bench.
- Added source lifecycle/error tests, chat offline/opening/read-marker regressions, AI
  top paging with anchor preservation, and browser PDF zoom/page-placement assertions.
  The boundary gate's package count was stale at twelve after adding `virtual`; it is thirteen.
- Documented protocol, anchors, ordering/tokens, trim/cache, DOM mechanics and verification
  in `docs/impl/virtual-scroller.md`; updated the requested design/index/selector documents.

## Verification

All large scratch locations used the worktree's disk-backed `.tmp`:
`TMPDIR`, `TALOS_LARGE_TEST_TMPDIR`, `TALOS_PACKAGE_E2E_TMPDIR`.
Commands have wall-clock timeouts; browser/server ports are dynamically allocated.

| Command | Exit / evidence |
|---|---|
| `pnpm install` | 0; shared store required sandbox escalation |
| `pnpm --filter @talos/virtual test` | 0; 3 files, 37 default tests |
| `VIRTUAL_BLOCKS=100 pnpm --filter @talos/virtual test` | 0; 5,000 seeds, 129 test cases, 93.35 s |
| `pnpm --filter @talos/client test` | 0; 73 files, 649 tests before the final two regressions |
| targeted AI controller tests | 0; 25 tests, including earlier-page anchoring |
| `node tools/e2e/run.mjs virtual` | 0; current Chromium |
| `node tools/e2e/run.mjs virtual --legacy` | 0; real Chromium 70, including fallback |
| targeted `chat`, `library`, `ai`, `admin`, `hardening` | 0 on current Chromium after fixes |
| targeted `library --legacy` | 0, including exact offline resume |
| `pnpm check` | pending final gate |
| `pnpm e2e` | pending final gate |
| `pnpm e2e:legacy` | pending final gate |
| `pnpm package` | pending final gate |

Initial gate failures were an assignment to a readonly test fixture, the stale boundary
package count, and the defects above; all were fixed. One current-browser hardening run
measured a 202 ms conversation scroll long task against the unchanged 200 ms budget; an
isolated rerun passed at 188 ms. The character reflow assertion retains its 2 px tolerance
and now compares before/after DOM coordinates, rather than assuming the character began
at zero (which would force a partial-line jump). No existing numerical tolerance was widened.

Quota meter: initial sandboxed invocation timed out; the approved read-only invocation
succeeded and reported 5% of the weekly window used, with no reset credit consumed.

## Shared files and integration notes

- `packages/contract/src/modules/library.ts`: optional finite `charInset` in the existing
  progress value. No database migration. Existing positions without it remain readable;
  older servers with strict validation need the matching contract deployment.
- `tools/boundaries/graph.mjs`: `virtual -> base` for `AppError`.
- `tools/boundaries/boundaries.test.mjs`: expected thirteen packages.
- `pnpm-lock.yaml`: declares the new `@talos/base` workspace dependency of `virtual`.
- Requested client integrations, feature e2e, e2e README and implementation docs changed.
  No root configuration, HANDOFF, ROADMAP or numbered decision log edits. No merge or push.
- No tolerance was relaxed for wheel input: expected movement comes from an independent
  native box. Per-frame motion is bounded by that displacement and must remain monotonic;
  stationary anchoring stays below 1 px drift.

## Proposed decision (orchestrator assigns the D-number)

**Id-based source-owned scrolling replaces index-owned VirtualList state.** All long-content
views use the standalone virtual package, whose DOM-free core consumes a single ordered
source stream for requests and pushes. Stable ids and first-visible-item anchors separate
loaded, rendered and visible windows; feature controllers retain loading and retention
policy. The DOM driver preserves native gestures by deferring offset rebasing and defers
render notifications inside measurement observers. Text resume retains both a UTF-16
character and its screen inset so reopening does not snap partially read lines.

## Limits

Native Windows, physical tablet touch hardware and external live AI providers were not
run. Browser gestures use CDP, including real Chromium 70. The no-ResizeObserver fallback
measures every animation frame while mounted; its idle cost is explicit. Performance
measurements are host/throttled-browser results, not device qualification.
