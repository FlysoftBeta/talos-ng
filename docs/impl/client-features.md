# Client feature mechanisms

Per-feature client design that is not part of the shared runtime (`client-runtime.md`). All
features follow the model / connect / view / adapters split (`structure.md`); this lists the
non-obvious mechanisms. Entry points: `packages/client/src/features/<feature>/` (`module.ts`
or `model/module.ts`, `connect`, `index.ts`).

## Chat

- The frame imports only `connect/index.tsx` (`ChatList`, `ChatContent`, `ChatBackground`,
  `useChatUnread`); the replacement list for a redesign is the view files plus `chat.css`.
  Controllers (list, conversation, composer, group browser, members, cached image, sticker,
  post card, background retention) expose `subscribe`, `getState`, actions and a derived
  `presentation`.
- Pending text keeps its own durable local body; huge text is sent as FIFO staging chunks
  plus a final immutable reference. Draft save acknowledgements are fenced by a write
  generation so an older completion cannot overwrite the saved marker or resurrect text
  after sending. Failed facts stay visible with retry/discard; failed state projections roll
  back.
- Full-body downloads use conversation-scoped keys plus the row revision, which tells
  apart several edits in the same millisecond; conversation image owners and retention
  metadata use the same scope prefix as the runtime's revocation purge.
- Retention is a rolling window from send time (7 or 183 days): it pages backward from the
  newest post, downloads full text, thumbnails, originals and sticker bytes, and refreshes on
  new posts, revisions, policy changes and hourly via the injected runtime timer. Auto
  releases the retention owner. Failed passes are reported and resume after reconnect.
- Opening at the first unread fetches both the first-unread window and the latest window; gaps
  stay explicit and reply jumps page backward from the replying message. Image load capture
  re-measures rows explicitly (no ResizeObserver on Chrome 70).
- Notification dedupe is bounded to 200 post ids (compacted to 100). Display Blob URLs are
  revoked on unmount; only byte arrays reach FileStore. Binary reads share the runtime bound
  of four calls.

## Library, reader, netbooks

- `libraryModule` projects `libraryDoc`, `libraryCollection`, `libraryState` and personal
  `libraryRetention`; `app/areas.tsx`
  supplies the reader slot and the netbooks toolbar entry, so the library imports neither.
  `SharingAdapter` lets the grant sheet serve media playlists without library RPCs.
- Models: `library-data`, `collections`, `documents` (ranged pack reading), `import`
  (chunked upload, 256 KiB chunks for PDF; the dialog closes at once, conversion is a server
  job; transfer failures show in the status centre, conversion failures in tasks),
  `retention` (serialised background scheduler); reader: `reading-session`, `resources`,
  `clock`. Viewer details: `documents.md`.
- Library and media retention are personal `me:<user>` rows per item or collection. Policies
  use LWW values and personal last-use clocks; schedulers take the latest applicable expiry
  across an item and its current collections. Unset/auto never starts background downloads.
  Expiry timers and bounded retry timers drive serial passes. Account changes, cancellation
  and revocation are re-checked after awaited work. Cleanup releases expired or revoked
  ownership and collects unowned files.
- Netbooks: a controller owns search, cooldown and download submission through runtime ports;
  search state is memory-only; countdown uses the server-provided remaining duration to
  tolerate clock skew; button actions are serialised; closing the dialog leaves the job.

## Learning

An application-wide `LearningProvider` owns the practice session, a navigation guard that
covers all exits (concealment still immediate; the interrupted summary shows after unlock;
browser unload uses the standard confirmation) and one active-use discipline deadline that
counts only visible, unlocked time and follows the user across areas. Screens read one
repository containing the `learn` corpus and the user's progress; decoding of the
deflate-packed corpus is bounded and memoised. Speed and clear-wrong modes pause when the
tab is hidden and ask to resume. An empty corpus or unavailable practice offers a return
action so discipline cannot trap the user.

## Media

`MediaPlayerProvider` stays mounted across areas; `PlaybackController` takes audio, transfer
and session ports and owns preparation generations: **lock or logout cancels a track still
being prepared** so a concealed session never starts audio. Playback requests live audio
(ticketed object) first and validates length and SHA-256, then falls back to a complete
verified FileStore entry; a Blob exists only to form a temporary playback URL created at use
time and revoked afterwards. The rail mini-player pauses on concealment; Media Session
actions are feature-detected and tolerate unsupported names. The newest response volume cap
is applied before audio starts and cached in user-scoped IndexedDB for offline restart.
Retention owners are per user and playlist/track; expiry follows creation until the first
play, then the last play.

## AI

`aiModule` registers reducers, repositories and windowed message intervals. Search is a
350 ms debounce over cached titles and tags. Text drafts are durable outbox writes (including
long-text staging); uploaded image selections are account-local strings; sending, upload,
workspace changes and admin operations require `useCan`. History is readable offline; long
bodies and opened workspace files are cached as strings; file edits send server revision
preconditions. Fork creates a separate owned conversation with the selected message's history.

The AI views use collection-pane rows and a 760 px reading column: user text has a raised
surface, assistant text stays unboxed, and the shared composer swaps send for stop while a
run is active. The list connection supplies synchronized quota and unread values directly
to presentation without parsing summary strings. Workspace browsing and editor overlays use
the same controller contract; account and ledger tables use DataGrid, with grants in a
dialog. Copy selects the fully rendered message body and uses the browser copy command,
including on Chrome 70 and non-secure LAN origins.

**Rich text** (markdown-it + KaTeX, WOFF2 math fonts) is an independent hashed classic-script
bundle that is part of the shell installation manifest but loaded lazily on first rich-text
display, so neither library is in the main bundle. Completed Markdown blocks keep their render
results; streaming scans only appended characters and renders an unfinished block as plain
text until its boundary closes (code fences and display math protect blank lines), never
re-rendering the whole answer per token. Raw HTML and remote images are disabled, links allow
HTTP(S)/mailto behind a confirmation, KaTeX trust is off and expansion bounded. Mermaid shows
labelled source rather than adding a second rendering engine.

## Admin and ops panels

Admin is an online-only full-content area: every query and mutation is an online contract
method, nothing enters IndexedDB or sync scopes, and the workbench shows `离线不可用` offline.
The navigation overlay stores only the workbench's open state, so existing per-user
navigation records and Back behaviour are unchanged. Controllers per workflow sit on the
narrow runtime ports; `QueryResource` is the generation-guarded in-memory online query every
pane uses. Role filtering of the section list is only a navigation aid; each RPC rechecks
authority. The user editor sends only changed fields the role may manage. Extension panels
(AI billing, ops) are injected by `app/areas.tsx` as descriptors `{id,title,requiredRole,
component}` so admin, ai and ops import none of each other. Ops controllers share
`OpsPanelController` (permission-aware loading, confirm/busy/error sequencing, disabled
reasons); the update upload (begin, 512 KiB FileReader slices, commit, stage, abort on
failure) lives in `UpdateController`. TLS configuration stays in the server config file; the
panel reports status only.

## Tasks

`TasksSheet` reads the `tasks.jobs` repository (no polling), shows records in creation order
and sequences retry/cancel/cleanup in `TaskController`. Cached records stay visible offline;
display labels per job kind live in the model, unknown kinds fall back to a generic label.

The task view separates active and finished records, preserving creation order inside each
section. Its connection passes kind, state and progress as presentation data; the view
chooses an icon and renders a progress bar without decoding display strings. Retry, cancel
and history cleanup retain their existing permission checks and confirmation flow.

## Settings

The settings sheet composes grouped account, appearance, security and diagnostic rows.
Profile editing expands inline; its controller and validation stay independent of the
presentation. Preference controls use the existing synchronized values and operation marks.
Do-not-disturb is a switch; other preferences are segmented choices. Lock and logout remain
visible in the sheet footer. Diagnostics are also available in a separate sheet so they can
be read without scrolling past the preferences. PIN replacement reuses the auth PIN entry
and its keypad styling inside a small dialog. Destructive confirmations use the shared
confirmation dialog's busy state to prevent dismissal and repeat submissions while running.

## Recent and frequent views

`core/ranking` holds the pure frecency algorithm (`frecency.ts`: decayed visit counter,
recent/frequent/frecent selection with a score-relative variable-length cut-off and a hard
maximum, pruning) and `AccessHistory` (`history.ts`: one `[score, at]` counter per
`<kind>:<id>` for conversations, books, booklists, songs and playlists, saved as one
bounded kv document per user through `getLocal`/`setLocal`, debounced, local only).
`platform/react/use-access-history.ts` shares one history per runtime and user.

`app/recent.tsx` is the connect layer: `RecentTracker` turns navigation changes
(`features/recent/model/tracking.ts`) and the current song into visits, and `RecentHome`
resolves titles from the chat, library and media data and fills `RecentPanelView`, the global
panel hosted by the chat area's landing page. The music and reading list panes compute their
own recent/frequent sections from `model/recent.ts` and render the shared `RecentSection`
ui component; items that no longer exist are filtered out before the cut-off is applied.
