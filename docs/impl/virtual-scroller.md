# Id-based virtual scrolling

`@talos/virtual` owns scrolling geometry without owning the data or depending on React.
`Scroller<T, L>` is the DOM-free state machine; `Source<T, L>` owns the ordered items.
`@talos/virtual/dom` supplies `DomViewport`, and the client's `VirtualScroller` binds it to
React. The main entry typechecks against ES2018 without DOM types. Only the DOM entry needs
a browser. Neither entry stores data or imports application contracts.

## Source protocol

A source connects one ordered event stream. Both replies and spontaneous changes use that
stream: a reply must reflect every change emitted before it. Requests carry increasing
tokens. `seek` opens at a stable id, a source-defined key (such as a message sequence), or
an end; `extend` asks for items immediately before or after a loaded boundary id. The core
never searches a remote index. A seek reply supplies the resolved focus id and a contiguous
window, with booleans describing the two remaining ends. Empty replies have neither end.

Pushes insert adjacent to an id or at a reached end, update payloads, remove ids, announce
more data, or invalidate the ordering. An invalidation reloads around the current anchor.
A newer seek supersedes earlier seek and extension tokens, so late replies cannot relocate
the view. Failed ends retain their reason and wait for `retry()` or a new availability
announcement. An empty extension that still claims more fails with `E_PROTOCOL` rather
than spinning. Synchronous request exceptions follow the same failure path as failed replies.

`ArraySource` adapts a caller-owned immutable array. It maps ids to positions, diffs pushes,
and reloads when surviving ids reorder. `prepare` may obtain a seek target; `load` obtains
an exhausted remote end; `locate` resolves an application key. These hooks update the array
with `set` before resolving. Async replies read the latest array, and disconnecting prevents
old completions from reaching a new connection. Duplicate ids fail atomically with
`E_INVALID`. An empty array gaining a remote end triggers a new seek because there is no
boundary id from which to extend.

## Anchors and windows

Normally the first item intersecting the viewport is the anchor. Its id and its top relative
to the viewport survive measurements and edits. Growth above it is compensated; growth of
the anchor leaves its top fixed and moves only items below it. Removing the anchor gives
its position to the next surviving item, or the preceding item if no successor remains.
Physical list ends still clamp scrolling. A clamped anchor is kept while estimates settle.

Programmatic start, center, end and edge placements hold their target while sizes settle.
User input releases that placement. `stickToEnd` follows additions and growing content
only while at the end. A small user-created gap inside `endThreshold` remains until content
changes, when the end is followed again. Scrolling farther away restores normal anchoring.

Loaded items, rendered items and visible items are distinct. `getSnapshot().items` covers
the viewport plus pixel overscan; `visible()` reports actual viewport intersections.
Geometry updates independently of render snapshots, so scrolling within the rendered range
need not rerender React. A Fenwick tree supplies logarithmic size changes, prefix sums and
pixel lookup; structural edits rebuild it in linear time. Size hints are replaced by
measurements. Width changes invalidate cached measurements of unloaded items.

Prefetch starts before a loaded edge reaches the viewport. `maxItems` trims the farther
side outside the prefetch region, retaining everything needed for the viewport and its
overscan even if that exceeds the limit. Trimmed sides become loadable again; measured ids
can be remembered in a bounded cache. Data retention remains the source's responsibility.

## DOM binding

The scroll element has no vertical padding and a permanent scrollbar gutter. A relative
canvas holds three absolute layers: leading slot, normal-flow items, trailing slot. Item
wrappers establish independent flow roots. Measure the inner viewport from its border box
top plus `clientTop`. `overflow-anchor: none` prevents competing browser anchoring.

`DomViewport` measures item and slot heights together, reports native scrolling as a delta,
and writes the resulting geometry. ResizeObserver delivery can change geometry before
paint. Render notifications raised during that delivery wait for the next animation frame;
mounting new observed items inside delivery can otherwise produce ResizeObserver loop errors.

Writing `scrollTop` during native smooth wheel scrolling cancels the remaining movement on
Chromium 70. During wheel or touch activity the driver therefore translates the three layers
by the anchor correction, preserving the browser's scrolling. After 160 ms without movement
(and after the finger lifts), it rebases the layers and native offset together. Explicit
jumps still take effect immediately. The idle timers are injectable and are cancelled on
detach. The driver checks for unreported user movement before writing geometry. Browser clamping
after resizing, and resetting offsets while a pane is hidden, are layout changes rather
than user input; they preserve the anchor and trigger remeasurement.

Without ResizeObserver, animation-frame measurement catches CSS animation and reflow;
a MutationObserver also catches DOM changes later in the same frame. Driver-owned layer
style writes are excluded to prevent feedback. Both observers defer render notifications.
The fallback costs one measurement pass per frame while mounted, including when idle.

## Client ownership

Chat owns its history source: unread opening, bidirectional pages, offline failure reasons,
reconnect retry and uncached reply searches. AI owns its transcript source and follows the
streaming answer at the end. Reader units use stable unit ids and page-size hints; saved text
positions refine a unit offset to a UTF-16 character through DOM Range geometry. The
optional `charInset` records that character's top relative to the viewport, preserving a
partially read line instead of snapping to its top on every reopen. Older positions without
an inset retain their prior character-at-top restore behaviour. Width and
zoom changes preserve relative depth, and page input seeks by unit id. Sticker packs, grid
pages and the gallery use the array binding. Grid pagination and selection remain controlled
by the caller; virtualization does not change which page is selected.

## Verification

State-machine scenarios cover anchoring, placement, source ordering, token cancellation,
failures, end following and trimming. A seeded model combines delayed/out-of-order request
completion, ordered event delivery, edits, measurements and scrolling; invariants run after
every step. `VIRTUAL_BLOCKS=100 pnpm --filter @talos/virtual test` runs 5,000 seeds;
`VIRTUAL_SEED` and `VIRTUAL_TRACE` reproduce a failing sequence.

The `virtual` e2e gallery bench uses real CDP wheel and touch input on both current Chromium
and Chromium 70. A plain native scroll box independently measures expected input movement.
Assertions read item rectangles, sample animation frames, check gesture direction and final
movement, preserve anchors without input, and probe viewport coverage for blank bands.
Native scrolling may span several frames, so motion assertions use its measured interval;
subpixel layout and integral legacy scroll offsets allow less than 1.5 px final error.
Stationary anchor drift must remain below 1 px. The bench also disables ResizeObserver and
animates DOM sizes without React commits. Feature e2e verifies the application integration;
selectors identify stable ids, never assume all source items are mounted.
