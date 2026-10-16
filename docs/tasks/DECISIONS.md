# Decisions

The owner is unavailable; decisions are made by the orchestrator and recorded here. Format:
`D-nnn — decision. Why. (Consequences / revisit trigger.)` Append only; supersede by new entry.

## Foundations

- **D-001 — pnpm monorepo of small packages with a lint-enforced dependency graph**
  (`docs/impl/architecture.md`). Sharp boundaries and independent tests are an explicit goal; mechanisms
  (`link`, `objectstore`, `docpack`, `docpipe`, `store`, `sync`) must be usable without the app.
- **D-002 — (Superseded by D-111.) Zero native Node addons; SQLite through built-in `node:sqlite` behind a `Db`
  adapter.** Verified on Node 22.23.1 (SQLite 3.51, `backup()` present). Removes the win32
  prebuild problem entirely and makes cross-packaging pure file assembly. The API is flagged
  experimental, so the Node runtime is pinned and bundled (D-003) and all use goes through one
  adapter file. Revisit (swap adapter to better-sqlite3) only if a blocking bug appears.
- **D-003 — Releases bundle the official Node runtime** (pinned, initially 22.23.x; one constant
  in `tools/`). Legacy required a host-installed Node; bundling removes a host prerequisite and
  makes D-002 safe.
- **D-004 — (Superseded by D-111; chat thumbnails already server-side per D-071.) No `sharp`.** Image thumbnails are produced by the uploading client (canvas → WebP →
  ArrayBuffer) and uploaded with the original; the server validates magic bytes, dimensions and
  size limits in pure TS. Trade-off accepted for a small managed community.
- **D-005 — No Rust/WASM toolchain.** Legacy used WASM for the virtual list (Infini) and zstd
  decoding. The rewrite uses a pure-TS virtual list and raw-DEFLATE resources decoded with
  `fflate`; zstd from pdfrender output is decoded once on the server with `node:zlib` (verified
  available incl. dictionary option). Fewer toolchains, no Chrome 70 WASM-MVP constraints.
- **D-006 — Server is a single process, no worker-thread executor pool.** At this scale SQLite's
  synchronous single writer is simpler and faster than cross-thread RPC; the legacy pool was a
  source of stuck-queue and timeout bugs. Heavy work is child processes or chunked async I/O.
- **D-007 — Dependencies passed explicitly (kernel object), no AsyncLocalStorage/globals.**
  Testability.
- **D-008 — ULID ids, integer-millisecond times, STRICT tables, forward-only per-module
  migrations.**

## Transport

- **D-010 — Own binary message protocol "link" over a single WebSocket carrier; JSON header +
  opaque body per frame** (`docs/impl/link.md`). Charter: own transport, nothing tied to HTTP
  semantics. JSON headers keep it debuggable; bodies keep it binary-capable.
- **D-011 — No stream frame types: uploads/downloads are sequences of ordinary calls with
  ≤ 512 KiB bodies.** Flow control = awaiting replies; resumability = offsets; far less protocol
  surface. LAN throughput is ample.
- **D-012 — The transport never queues or retries.** Offline → immediate `E_OFFLINE`. Durable
  intent is exclusively the outbox's concern (single owner).
- **D-013 — HTTP is reduced to a static/bootstrap gateway + ticketed `/dl/<ticket>` byte
  downloads** for `<audio>` and save-to-disk. Business errors are link error codes, never HTTP
  statuses (fixes legacy "500 for denials").
- **D-014 — One user session bound per connection; a device remembers up to two accounts for
  fast switching.** Simplifies legacy multi-actor sockets while keeping the shared-tablet
  behaviour (max two live users per device).
- **D-015 — Multi-port listening stays (config list) but client-side multi-origin load
  balancing is dropped.** With one multiplexed connection the per-origin connection limit that
  motivated it is gone.
- **D-016 — `ws` (pure JS, bundled) as the WebSocket implementation on the server; no
  `bufferutil`.**

## Data, sync, offline

- **D-020 — Row-revision sync over access scopes; pull on every connect is the correctness
  path, pushed deltas are an optimisation** (`docs/impl/sync.md`). Replaces legacy
  revision-sums/coverage/snapshot zoo with one mechanism.
- **D-021 — Client writes go through a durable outbox with idempotency keys and optimistic
  local reducers; conflicts resolved by shared pure functions (LWW / Max / immutable).**
- **D-022 — Text and sticker posts may be composed offline and are queued (visible 待发送,
  cancellable).** Deliberate departure from legacy (drafts only). Server validation still
  decides; rejections surface in the status centre. Images stay online-only in v1.
- **D-023 — Client persistence is IndexedDB only, including the app shell: no Cache Storage.**
  The ServiceWorker serves assets from IndexedDB ArrayBuffers. Strict reading of hard
  constraint 3; also gives atomic build switching and rollback.
- **D-024 — Multi-asset build served by the SW instead of legacy's single blob-URL module.**
  Allows normal script/CSS/font assets; hashes verified at install.
- **D-025 — Client files are content-addressed (`rid` = SHA-256 of decoded bytes), ≤ 1 MiB
  ArrayBuffer chunks, owner-tagged for retention/eviction.**
- **D-026 — Server objects are content-addressed with a SQL reference ledger and real GC +
  fsck.** Fixes legacy "no global GC, every domain must reconcile" leak class.
- **D-027 — Backups include objects (manifest + referenced objects), not only SQLite.**
- **D-028 — Jobs are durable rows synced to the owner** (task list without polling; PDF
  conversion and novel downloads survive restart).

## Documents

- **D-030 — Reuse the legacy `pdfrender` prebuilt binaries as-is** (vendored copies of
  `lib/poppler-prebuilt`, GPL-2.0-or-later, licences shipped). Invoked exactly as legacy did.
- **D-031 — Canonical rendition = TDP pack (own, format-independent; `paged` | `flow`)**; the
  pdfrender archive is validated strictly and transcoded at ingest. Text and novels are `flow`
  packs too, so one storage/delivery/offline path serves all formats and EPUB is one converter
  away.
- **D-032 — Paged units render in per-page sandboxed iframes with CSP and sanitising**, as in
  legacy (proven security boundary), with a re-implemented frame runtime. Adds zoom and page
  jump (legacy had neither).
- **D-033 — Password-protected PDFs: rejected with a clear message in v1** (same as legacy).

## Client and UX

- **D-040 — React 19 + MUI 7 + Emotion + Zustand, bundled by Vite with target `chrome70`,
  `core-js` subset first.** Owner's preference; legacy proved this stack on Chrome 70.
- **D-041 — State-based navigation: one serialisable reducer-owned `Nav` value, persisted per
  user; per-area stacks; Back button trapped → lock** (keeps concealment feature F-011).
- **D-042 — Design language "安静的仪表盘"** (`docs/product/ux.md`): rail + list + content,
  status pill + 状态中心, single StatePanel vocabulary, semantic colour only for state.
- **D-043 — Product behaviours kept from legacy unless listed here:** hidden unlock sequence and
  Back-to-lock are kept (managed-device concealment is intentional). Insulting/harsh copy in
  learning exit dialogs is replaced with neutral wording. Music queue auto-advances at track end
  (legacy stopped; judged a bug). Reading time only accrues while the page is visible.
  Discipline mode timer is app-wide, not only on the learning dashboard.
- **D-044 — Product name stays "Talos II"; code name `talos`.** Package scope `@talos/*`.

## Tooling and process

- **D-050 — Codex models:** complex = `gpt-6-astra` (high). Simple = `gpt-6-sol` (medium) — the
  charter says "6.1 Sol" but the installed CLI's model list has no 6.1; `gpt-6-sol` is the
  closest match (`gpt-5.6-sol` also exists).
- **D-051 — Vitest for unit tests, Playwright for E2E, raw-CDP harness for real Chromium 70.**
- **D-052 — `tsc` (TypeScript 6) is the type-check baseline; tsgo optional later.**
- **D-053 — Legacy sticker packs / word corpus / icons are copied as product assets at the
  milestone that needs them; third-party provenance is unchanged from legacy and noted in
  README.**
- **D-054 — TypeScript 7.0.2 checks source; TypeScript 6.0.2 supplies ESLint's API.**
  Supersedes D-052's version baseline: Task 001 requires current stable tooling. The npm
  `typescript` stable tag is now 7.0.2, whose compiler API is incompatible with
  typescript-eslint 8.71.2 (supported peer range `<6.1`). The root aliases `typescript7`
  to the current compiler and `typescript` to Microsoft's `@typescript/typescript6` package;
  `tools/typecheck.mjs` selects the native compiler explicitly and portably. No peer warnings.
  Remove the compatibility alias when typescript-eslint supports the TypeScript 7 API.
- **D-055 — M1's dependency table makes the leaf-package interpretation explicit.**
  objectstore/store depend only on base; docpipe may use base+docpack and objectstore types;
  launcher depends only on base. Shell stays dependency-free, including no base dependency.
  Contract may import docpack types only. Client can import shell's public installer API;
  server cannot import browser packages. Source imports and re-exports require declared
  `workspace:` edges and public entry points. Tests alone may import Node built-ins.
- **D-056 — Source-first packages, independently discovered test projects.**
  Libraries export `src/index.ts`; build aliases typecheck until a package actually needs an
  artifact. The compatibility tool is directly executable ESM and validates itself with
  checkJs. Root Vitest discovers each package manifest and optional local config; production
  isomorphic typechecks exclude tests and all ambient Node/DOM types. Browser worker configs
  opt into ES2018+WebWorker separately to avoid conflicting DOM/worker declarations.
  Prettier leaves existing orchestration documents and intentionally bad fixtures untouched.
  pnpm installs are explicit (`verifyDepsBeforeRun: false`) so scripts do not modify installs
  or lockfiles. Runtime primitives use only Chrome 70 APIs; IDs default to Math.random and
  are not credentials. Overflow/invalid wire values throw instead of silently truncating.

## M9 identity and admission

- **D-057 — A second PIN is an optional, equivalent credential for the same account.**
  The legacy onboarding calls it a backup PIN, and the server maps both credentials to
  one user. Preserve one or two distinct globally unique six-digit PINs; replacement
  verifies any current PIN and replaces the entire set. It is not a confirmation or
  duress code. The legacy has no self-service session-list/revoke screen, so M9 does
  not add one. PIN replacement revokes other sessions.
- **D-058 — Stable browser device IDs replace MAC/IP/user-agent identity matching.**
  Store the registered ID in IndexedDB and display it on auth screens. The legacy's
  missing-MAC matching could merge unrelated devices; a browser ID avoids that accidental
  coupling and works on Windows and Linux without host commands. IP is a separate
  server-side throttle key, never an authority or device identity. Clearing browser
  storage intentionally creates a new device which remains subject to admission policy.
- **D-059 — DND uses the same durable LWW outbox as theme; personal identity changes
  stay online-only.** The legacy data model already supported disconnected DND proposals
  but its UI disabled them. M9 removes that inconsistency. Profile, PIN, invitations,
  onboarding and server-backed logout need a live connection and an explicit disabled
  reason when offline. About becomes an in-app diagnostics sheet rather than a native
  alert, with server address and storage information available without a request.
- **D-060 — Six-digit PIN verification and lookup are both memory-hard.** A deterministic
  scrypt lookup uses a generated per-database salt; every credential also has an independent
  random salt and scrypt verifier. A fast HMAC index with its key in the same database would
  otherwise bypass slow verification in an offline attack. Existing M7 HMAC credentials
  upgrade after successful login, with an atomic recheck so an in-flight upgrade cannot
  resurrect a replaced PIN. Wire KDF work is asynchronous and limited to two concurrent
  derivations; bootstrap and trusted in-process helpers retain synchronous variants.
  Five wrong attempts block a device for 15 minutes; 20 block its IP for the same period
  to constrain fresh-device bypass without giving a shared school NAT a five-attempt budget.
  Invitations expire after seven days; the redemption token expires after 15 minutes and is
  tied to its device. Both PINs remain globally exclusive across users and live invitations.
- **D-061 — Preserve concealment and make reset explicit.** The exact legacy direction
  sequence, touch zones and 700 ms synthetic-mouse suppression remain. Browser Back uses
  the existing single same-URL sentinel rather than stacking ten history entries; it still
  immediately conceals the app. Reset closes participating tabs' runtimes, rebuilds only
  `talos-app`, restores its stable device ID, and preserves `talos-shell`. Its confirmation
  counts pending and failed operations across every cached account. A blocked IndexedDB
  deletion stays pending with a close-other-tabs message until it can finish; rejection
  would falsely imply cancellation of an unabortable database deletion.
- **D-062 — Authority is separate from preferences and resource access.** Keep all eight
  legacy specialist roles with dependencies and last-root protection. Root can manage roles,
  gates and invitations, but neither root nor base administrator implicitly reads arbitrary
  resources or bypasses feature gates. Read/write/own grants and trusted resource ownership
  control resource access through one `AuthorityService.can` entry point. Reader, ebook and
  article-download gates also require `articles`. Roles/gates and effective grants project
  into `me:<user>`; future community membership changes must trigger grant reprojection.
  System-lock administrator exemption is retained; a fresh valid PIN recovers idle lock.
- **D-063 — Credential versions fence offline verifier reuse.** PIN replacement increments
  a monotonic credential version returned in session/replacement replies and synced in the
  profile. A client may retain both locally known PIN verifiers across online unlock only
  while the authenticated account and credential version still match. A newer synced
  version clears stale verifiers, including in other tabs sharing the current device token.
  Known session revocation clears offline authority immediately; denied sessions may retain
  a separate revoke-only token so online logout still revokes the server session. That token
  cannot resume a local account or unlock cached data. Older cached profiles must never
  downgrade an authenticated credential version.
- **D-064 — M16 complete backups are independent streamed snapshots of SQLite and every
  ledger object, with a linewise SHA-256 manifest.** The GC sequencer pins objects during
  incremental copying to a backup directory; download emits a Talos v2 framed archive directly
  through the HTTP gateway, and restore validates entries incrementally before DB replacement,
  preserving the pre-restore database. No configured backup size cap or aggregate byte buffer
  exists; database rows and metadata stream too. A 2+ GiB synthetic object set exercises the
  full create/HTTP-download/restore path and bounds peak RSS growth to 256 MiB. Default
  retention is five and daily jobs follow the Beijing calendar. Release-update ZIPs retain
  their separate 512 MiB validation limit.
- **D-065 — Launcher switches an atomic pointer file with a durable state record, never
  symlinks or running-directory swaps.** Candidate confirmation is explicit within the original
  three-minute deadline; crashes/timeouts restore both release and pinned complete backup.
  The shell's separate client confirmation is verified across an actual packaged update.
- **D-066 — HTTP→HTTPS redirect is 308 with no-store.** Replaces legacy permanent ten-year
  browser cache; `/ca.crt` remains accessible over HTTP. Multi-origin distribution F-143 is
  dropped, preserving D-015's configurable multi-listeners.
- **D-067 — Ops uses the M9 authority service and shared action vocabulary.** Every ops
  RPC calls `AuthorityService.can` against current access projections. Host tools, settings
  writes and server updates require root; backup/HTTPS/Office accept administrators. The
  temporary root-only sheet is reached through 管理 in the M9 rail, with synced `useGate` /
  `useCan` capability checks and offline reasons. Ops migrations use `operations` because
  `ops` already names RPC idempotency storage.
- **D-068 — Official Node v22.23.3 is pinned and verified against nodejs.org SHASUMS256.txt.**
  Linux assembles both platforms without native Node addons. Full installs contain Node and
  launcher; in-app update ZIPs replace only versioned application/helper payloads. The archive
  mechanism is shared through a minimal server→launcher dependency edge.
- **D-069 — Office capture keeps COM enumeration behind an injectable Windows-only adapter.**
  Saved disk snapshots are hash-deduplicated and ledger-owned; unsaved buffers are not captured.
  Clearing does not immediately re-add still-open snapshots on the next automatic poll.
  Explicit capture can re-add them. Shutdown has a 10-second grace period. Wine verifies the
  packaged Windows server and PDF renderer, but does not establish native Windows COM or
  console-close correctness.
- **D-070 — Learning corpus and progress:** a versioned, deflate-packed corpus row in the `learn`
  scope enables complete offline practice. Per-user progress in `me:<user>` uses grow-only
  counters per device and observed-prefix wrong clears; component-wise maximum merge is
  commutative, associative, and idempotent. Ordinary correct adds one learned point and clears
  one observed error; explicit mastery adds two. A single visible-use timer implements
  application-wide discipline. Users may enable it themselves; feature managers may impose it
  for another user. Empty corpus and unavailable practice allow a safe return.

## M10 community and chat

- **D-071 — Chat thumbnails are generated on the server with Jimp, pure JavaScript. (Jimp replaced by sharp, D-111.)**
  Supersedes D-004 for M10's explicit server-generation requirement. PNG/JPEG/GIF/BMP
  originals (12 MiB maximum, 32 million decoded pixels) produce JPEG previews bounded
  to 480 pixels. Animated previews use their first frame. No native addon or WASM is
  needed on Windows/Linux; original uploads and thumbnails use the objects ledger.
- **D-072 — Large chat text uses queued 16,000 UTF-16-unit staging chunks.** The
  5,000,000-unit limit matches legacy JavaScript validation. Posts/drafts reference a
  completed private staging ID, preserving the transport header limit. JSON staging
  preserves split surrogate pairs; full body reads use bounded binary UTF-8 chunks.
  Windowed sync carries previews and IntervalSet coverage, never whole long bodies.
- **D-073 — Chat uses the shared outbox and five-area frame.** Text/sticker posts,
  drafts, read cursors, pin, mute, retention and announcement acknowledgments queue;
  creation/join/DM, edits/deletions, uploads and moderation require a connection.
  This deliberately enables offline text/stickers and pin. Feature gates protect
  restored areas and navigation; disconnection/reconnecting conceals cached content
  for users without offline entitlement. Failed sends remain retryable/discardable.
  Week/half-year retention is a rolling sent-time window, refreshed on changes and
  hourly; policy age does not expire the setting. Auto releases explicit file owners.
- **D-074 — Membership visibility and cached content follow conversation authority.**
  Hidden membership projects a shared tombstone plus a private self row; shared-group
  proof and discovery provenance are validated server-side. Membership changes also
  reproject authority grants. Fetched bodies and image ownership use conv-scoped keys
  purged on revocation; late scoped writes are denied. Pending drafts remain durable.
  Binary downloads are bounded per runtime to four calls to leave transport capacity
  for sends/sync while a sticker grid is loading. No module-global scheduler exists.

## M11 library and reader

- **D-075 — Every imported document has a durable source and one TDP rendition.**
  Text, UTF-8/GBK attachments and PDFs enter the format-agnostic docpipe registry through
  restartable `library.convert` jobs. Publication attaches ledger references and marks the
  document ready atomically. Failed jobs keep their source for explicit retry. EPUB can add
  a converter emitting flow units; network-novel providers can call the library import seam.
- **D-076 — Collection grants govern sharing; possession is not authority.**
  Collections use `coll:<id>` read/write/own grants with separately recorded delegation.
  Adding a received document to another collection requires a delegable access path, preventing
  read-only recipients from bypassing delegation. Original uploaders retain document ownership;
  F-144 bearer-token/ownerless recovery becomes access through a currently readable collection.
  Favourites never grant access. Durable item tombstones reconcile removals after disconnection.
- **D-077 — Retained reading uses verified complete packs and bounded page windows.**
  Explicit 1/7/180-day policies download TDP bytes through ticketed HTTP ranges into resumable
  FileStore writers; only complete hash-verified packs are readable offline. Auto does not
  promise offline availability. Viewer buffers and opaque sandboxed frames belong to mounted
  units; unmount releases their resources. Resume is LWW, furthest is Max, and reading seconds
  merge per-device maxima. Time accrues only while the app is visible and unlocked.
- **D-078 — Task retry is an explicit job-kind capability.**
  The synced task projection includes safe display titles, progress, estimated remaining time
  and errors, without exposing job payloads. Retrying failed/cancelled work requires its kind
  to opt in. History cleanup removes older terminal rows while retaining the newest 100 and
  all active work; it does not erase the newest failures.

## M15 administration

- **D-079 — Administration is an online-only full-content area.** Workbench queries
  page on the server and never enter sync scopes or IndexedDB. The 管理 rail entry
  opens a left section list; role filtering is a navigation aid, while each RPC
  rechecks the specific operation through `AuthorityService.can`. Every section
  shows 离线不可用 when disconnected. Existing operations panels live in this area.
- **D-080 — User administration applies independent changes per target.** Bulk
  calls return a result for each user and audit the batch and successful field
  changes. Role dependencies and last-root protection remain in authority;
  banning revokes sessions. Whitelist activation includes the current device,
  and current-device lock, deletion, or whitelist removal is denied.
- **D-081 — Initial M15 surface (superseded by D-083–D-085).** Part 1 deferred
  purge, group mutations, identity signals, and incident detail. Part 2 delivers
  these operations with the design decisions recorded below.
- **D-082 — Media policy is stored for later consumption.** The admin module owns
  maximum volume and cache eviction day values with validation and audit, but
  the media module has not been delivered and therefore does not consume them.
- **D-083 — Purge is a durable ordered job with a per-domain hook registry.** The
  admin command checks self and last-root safety before enqueueing; the job repeats
  those checks before deletion. Hooks clear domain records before identity and
  report progress through 任务. Hooks are idempotent so a restart can requeue a
  partially completed purge. Historical audit rows retain their actor identifier.
- **D-084 — Browser device identity uses observable signals.** Browsers do not expose MAC addresses. The stable client ID always keys a device; administrators may additionally select User-Agent and IP matching. The server stores SHA-256 signal hashes and rejects a changed selected signal on login or resume. A missing signal on a local transport is ignored. Existing devices enroll a selected signal on the next authenticated attempt; changing a policy may require affected users to ask an access manager for device help.
- **D-085 — System group types are reserved singletons.** Wild and announcement
  groups are seeded system groups and cannot be created or promoted in the admin
  editor. Ordinary group type stays immutable; its other attributes remain editable.

## M14 AI

- **D-086 — AI uses private windowed scopes and durable jobs.** `me:<user>` contains
  lists, LWW drafts and credits; `ai:<conversation>` contains windowed messages.
  Disconnects do not cancel runs. Queued jobs resume after restart; interrupted
  Responses streams retain partial output, settle checkpoints and fail explicitly,
  avoiding replay of visible text or committed tools. Search is free and local over
  user-authored titles/tags; the first configured Responses model handles text/images/tools.
- **D-087 — AI credits and workspace mutations are transactional.** Integer microcredit
  reservations pin UTC day/Monday-week plan allocations; usage settles once and caps
  at the reservation. Permanent fingerprinted top-up keys prevent duplicate credits.
  SQLite owns the 10 MiB/256-file logical workspace and tool journals; no host paths,
  archive extraction or code execution exists. SVG uses a narrow inert whitelist.
- **D-088 — Offline AI rich text is a lazy classic asset.** Markdown-it/KaTeX and WOFF2
  fonts are separate hashed assets installed by the shell. Finished blocks are retained
  while streaming; Mermaid displays clearly labelled source for Chrome 70 compatibility.
  Links confirm external navigation; HTML, remote Markdown images and trusted TeX are
  disabled. Long text uses staging/binary bodies to respect transport header limits.

## M13 media

- **D-089 — Materialised audio is an object-ledger asset created by a durable job.**
  Search and resolution store metadata; playback and retention enqueue bounded yt-dlp work.
  Packaged yt-dlp binaries are pinned and SHA-256 checked at package time, with a config
  override for local installations. Test-seed servers use an in-memory provider with real WAV bytes.
- **D-090 — Media lists use scoped rows and offline intent.** Playlists use `coll:<id>` access;
  personal queue, favourites, recents, and play preference use `me:<user>`. Favourites,
  queue replacement, play preference, and playlist last-play updates enter the durable outbox.
  Creating, deleting, sharing, search, and audio preparation require a connection.
- **D-091 — Playback tries a ticketed live object before verified local bytes.** FileStore
  holds ArrayBuffers under user and playlist ownership. Playback creates and revokes an object
  URL at use time. The player pauses on concealment, applies the admin volume cap, and offers
  Media Session controls when available. Track end advances by default with a 播完即停 option.
- **D-092 — Playlist retention starts at creation until its first play.** Afterward its
  expiry is based on last play plus 1–365 days. This gives a newly retained playlist a useful
  initial offline window. Tracks remain independent of a deleted playlist; the retention owner
  is released and the object ledger later reclaims unreferenced server audio.

- **D-093 — Network novels use official fetch and chapter checkpoints.** A single paced provider replaces browser pools and hardcoded mirrors/credentials. Verification or preview-only content fails explicitly. Search returns authoritative retry/server times; downloads deduplicate active owner/book/booklist requests and recheck authority on resume. SQLite keeps complete chapters until atomic library source publication records the document; kernel jobs requeue interrupted downloads and conversion. Search/download are online-only, while private job/document scopes expose progress and produced reading content.

## M20 independent completeness audit

- **D-094 — Make smaller parity changes explicit.** Reader favourites are queued offline;
  furthest progress is a unit ordinal, while resume retains its within-unit anchor and
  time counts visible use. Speed practice pauses while hidden and resumes with confirmation;
  navigation guards cover all application exits. Build updates follow server WELCOME after
  release restart rather than independent five-minute polling. Root force-offline debugging
  is runtime-local and resets on reload, avoiding persistent lockout and forbidden
  localStorage; Infini-specific debug controls have no meaning with the new virtual list
  (D-005). D-082's temporary non-consumption note is superseded: media playback and kernel
  maintenance now consume the volume/eviction policies.
- **D-095 — Do not count known regressions as completion.** Task 141 found boolean-only
  account bans (no legacy timed expiry), server-only incident records without environment/
  build filtering or current log files, synthetic self-test rows rather than real fault-path
  tests, and media track access based only on feature entitlement/existence. These are open
  implementation gaps, not approved drops. COMPLETENESS records the exact changed behavior
  and the (archived) audit retained partial verdicts, including bulk timed bans. Restoring them requires the
  cross-module work described there; D-076 is implemented for library documents only.
- **D-096 — Reuse existing administration and grant boundaries for audit repairs.**
  Discipline assignment is reachable in the role-gated user editor. Batch AI credits call
  the existing per-user assignment API with independent stable fingerprints; retry only
  failures, preserving keys even when a committed response was lost. Playlist delegates
  cannot downgrade stronger grants, change original-owner access, or revoke without own
  authority, matching library sharing. Custom mute durations coexist with presets; bulk
  enable does not extend an already active mute. Playback applies the latest response cap
  before starting audio and retains that cap in user-scoped IndexedDB for offline restart.
- **D-097 — Constraint audit uses manifest-only release payloads.** Client packaging includes only the installable shell and manifest assets; gallery/diagnostics stay development-only. Root forced-offline state never touches localStorage (it is runtime-local, see D-094). Shell download readiness and explicit activation are separate persisted states; navigation must not apply an unconfirmed staged update. Compatibility heuristics supplement real Chrome 70 execution; Wine results are explicitly not native Windows qualification. Cross-domain admin SQL ownership remains open pending an atomic domain-port refactor (constraints audit, archived; resolved by D-105/D-106).
- **D-098 — Read-only pre-v27 migration compatibility and client projection verification.** Schema v25/v26 bookmarks, group article collections and owned queues use connection-local views instead of the destructive legacy upgrade. Unsupported v25 path-based binary data fails before target creation. Migration rebuilds packed learning and chat summaries, uses valid legacy-device ULIDs, and verifies client-decodable state as well as SQL/byte counts. Private rehearsal artifacts remain outside the repository; only aggregate evidence is documented.

- **D-099 — Large validation fixtures can use a separate temporary root.** Optional `TALOS_LARGE_TEST_TMPDIR` (2 GiB backup test) and `TALOS_PACKAGE_E2E_TMPDIR` (packaged update e2e) select a disk-backed scratch directory for tests only; defaults stay `tmpdir()` and no product behaviour or timeout changes.

- **D-100 — Ban deadlines belong to identity.** Keep the existing banned flag for
  permanent-ban compatibility; a nullable epoch-millisecond deadline makes a ban timed.
  Admission, active-user/authority/root checks and projections evaluate the injected clock,
  including after restart. Bulk enable preserves an active deadline; unban clears it.
- **D-101 — Diagnostics capture faults without their payloads.** Retain source, build,
  bounded environment and redacted stack frames, never exception messages or call arguments.
  A user-scoped IndexedDB buffer retains at most 20 browser reports; the server permits
  30 reports per actor/minute. Self-tests use window errors and thrown RPCs. ZIP exports
  include the current build’s rotated server log records plus incidents/audit.
- **D-102 — Media references are not access grants.** Persist discovery per user and
  require discovery or a currently owned/granted playlist for each track operation and
  ticket redemption. Root status alone is not a track path. Copying requires ownership,
  discovery or a delegable grant. Shared tracks live only in collection sync scopes;
  upgrade resets old media mirrors, and scoped audio owners are purged on revocation.

- **D-103 — Exact distribution targets pin packages and updates (task 146).** IDs are
  `win32-x64`, `linux-debian-x64`, `linux-redhat-x64`. Installation target is
  immutable across updates/rollback; both staging layers reject mismatches. Renderer
  selection comes from the packaged target file, with distro-based development defaults
  and the existing explicit binary override. Keep the current renderer/format; a
  source-build and progressive-output proposal is recorded in the archived task-146 result.
- **D-105 — Structure changes follow ownership and preserve a replaceable UI boundary.**
  Task 147's plan (archived) separates application
  composition from kernel/core, moves foreign SQL behind owner ports, and splits
  client model/connection/view responsibilities with enforceable import rules.
  Current user purge commits each hook separately; the plan explicitly establishes
  one final deletion UoW after durable gating/quiescence rather than claiming
  atomicity already exists. No source moves or behaviour changes are made by this
  planning task; implementation and failure-injection verification remain pending.

- **D-104 — Bulk object durability precedes reference commits (task 148).**
  Catalog seeding and offline imports explicitly batch puts, flush files with bounded
  concurrency and directories bottom-up, then commit ownership/journal rows together.
  Interrupted batches leave replayable orphans; bulk replay validates hashes and repairs
  torn files. Catalog boot verifies references. Normal uploads retain per-object sync;
  Windows keeps file flushes and the existing no-directory-fsync policy. Pending schema
  migrations share a transaction per module; offline imports leave background jobs
  stopped so resumed conversion jobs cannot race object batches. E2E artifacts default to ignored output;
  `TALOS_E2E_UPDATE=1` alone refreshes tracked screenshots/marked measurements.

- **D-106 — The 147 plan is executed pruned (session 5).** 54 work packages are merged into
  ~20 jobs (archived execution plan). Dropped as churn: in-package
  compatibility facades, the domain regroup of the one-shot migrator (WP50), the
  `tools/package/build.ts` split (WP52), transaction-token invalidation in purge. The e2e
  harness reshuffle (WP51) is folded into the test-suite review. Client model/connect/view
  is a dependency rule, not three mandatory directories per feature.

- **D-107 — pdfrender stays as vendored binaries with the current format (session 5).**
  The task-146 proposal (source build, JSON-lines progress, 5–8 days) has no demonstrated
  quality gain and no measured workload that needs early pages; it adds three native build
  chains to maintain. Not a clear win, so not done. Revisit only with a representative
  slow or failing PDF corpus.
- **D-108 — Boundary engine, ratchet and SQL-owner gate (task 149a).** `tools/boundaries.mjs`
  is the public entry; the engine lives in `tools/boundaries/` (package DAG in `graph.mjs`,
  data-driven layer rules and named relative edges in `policy/<owner>.mjs`, resolver, plugin).
  The plugin now covers `packages/*/**` (src, bin, build scripts) and all of `tools/**`.
  Today's violations are recorded exactly in `tools/boundaries/exceptions.json` (layer entries
  `{rule,file,target}`, SQL entries `{rule:"sql-owner",file,table}`); `ratchet.mjs --check`
  (part of `pnpm lint`) fails on new and on stale entries, `--write` regenerates after moves.
  `sql-ownership.mjs` reads string/template literals through the TypeScript AST and a bounded
  SQL tokenizer; table owners are keyed by table in `sql-owners.mjs`. Foreign-key
  `REFERENCES`, `sqlite_*` tables and table functions are not treated as table access;
  interpolated or unreadable table positions fail unless the file is a listed gateway
  (none needed today). Build scripts and bin files are Node tooling even in browser packages.

- **D-109 — Locking or logging out cancels a track that is still being prepared (149j).**
  The playback controller owns preparation generations; a concealed session must not start
  audio. A failed "stop at end" surfaces as an error; the new-playlist dialog stays open
  while its command is only queued.

- **D-110 — Restructure closure (149z).** `tools/migrate` reaches the server only through
  the `@talos/server/migration` subpath (kernel, Db/UoW, object ledger, identity); server
  `src/` never imports it. The backup snapshot reads object inventory through the objects
  owner, so the boundary ratchet has zero exceptions. Feature controllers extend one
  `core/controller-state.ts` `StateStore`; the React binding `useController` lives in
  `platform/react` (legal for connect files, forbidden for models and views). Auth owns the
  handle and PIN-difference rules and exposes them through its TSX-free `model.ts`, which
  peer models may import. Feature views may import `@talos/contract` types only. Layout and
  rationale: `docs/impl/structure.md`.

- **D-111 — `better-sqlite3` and `sharp` return; each release stays platform-specific.**
  Supersedes D-002 and D-004 (and the Jimp part of D-071). SQLite is `better-sqlite3`
  13.0.3 behind the unchanged `Db` adapter (same WAL, `foreign_keys`, `synchronous=NORMAL`,
  busy timeout, savepoint transactions, online backup; the experimental-warning
  suppression is gone). Server image work uses `sharp` 0.35.5 (autoOrient, 480 px
  inside-fit JPEG quality 82, first frame of GIFs, transparency flattened on white).
  libvips cannot read BMP, so `chat/attachments/bmp.ts` decodes uncompressed 8/24/32-bit BMP
  to raw RGBA for sharp; RLE/16-bit BMP is now rejected as unsupported. Client-side canvas
  thumbnails were not reintroduced: the chat path was already server-generated (D-071) and
  nothing else needs them, so there is no client change and no Chrome 70 impact.
  Both addons are N-API, independent of the bundled Node ABI. esbuild keeps them external;
  `tools/package/native.ts` lays out only the target's files in the release's
  `node_modules/` (better-sqlite3 `lib/` plus `prebuilds/<platform>.node`; sharp, its JS
  dependencies, `@img/sharp-<platform>` and on Linux `@img/sharp-libvips-linux-x64`). The
  win32 packages are installed on Linux through pnpm `supportedArchitectures` so the
  lockfile pins their integrity, the pnpm store makes the step offline-cacheable, and
  `tools/package/native-manifest.json` pins SHA-256 of every native binary (re-pin with
  `node --import tsx tools/package/native.ts --pin` after a bump). Debian
  and Red Hat share the glibc linux-x64 binaries (sharp's libvips needs glibc 2.26+).

- **D-112 — Dependency refresh and upstream yt-dlp client selection.** Update stable
  workspace dependencies, CI action tags and packaged Node (26.12.0 Current);
  yt-dlp 2026.08.19 uses its own client defaults instead of forced web_music.
  Preserve Zod 3 pending a contract/Chrome 70 migration and Node 22 declarations
  to avoid exposing APIs outside the supported baseline. Preserve compiler roles,
  the intentional Chrome 70 fixture and pdfrender's vendored provenance.
  Per owner instruction, this update requires a successful build rather than full
  test gates. The unmodified main `pnpm build` passed; package/runtime behavior
  under the newer bundled Node is not established by that build.

- **D-113 — Node 24 baseline (supersedes D-112's Node choices).** Owner upgraded
  the host to Node 24 and requested the project use that major. Workspace engines
  are ^24.18.0, direct @types/node is 24.19.2, CI and packaged runtime pin 24.22.0,
  and server/launcher/migration emit for node24. Chrome 70 and Zod remain unchanged.
  Verification is the normal build on host Node 24.18.0, not a runtime/package gate.

- **D-114 — Source TypeScript entrypoints use the existing tsx loader.** Remove
  the experimental transform flag from commands and subprocesses. Their import
  graphs contain parameter properties unsupported by Node 24 strip-only execution,
  so source runners use node --import tsx with an explicit pinned dev dependency.
  Migration registers tsx in-process instead of spawning a bootstrap child.
  Production bundles are unchanged; verification remains build-only as requested.

- **D-113 — Unclipped floating controls.** Presentation-owned portal hosts keep menus,
  selects and tooltips outside clipping ancestors, with a separate host inside each modal's
  focus boundary. Open-only animation-frame positioning supports Chrome 70, viewport edges,
  ancestor scrolling and animations without ResizeObserver.

- **D-114 — Built-in booklists and source-based saving.** Each user has private physical
  我的书架 and 我的收藏 collections, pinned above recent documents and protected from
  deletion/sharing. Favorites use ordinary membership with the existing offline LWW command
  as concurrency metadata. Imports default to the shelf; transfers originate at an explicitly
  named accessible source with a delegable grant (or source ownership). Destination item
  updates only remove/reorder. Last-container removal immediately reclaims books, dependent
  state/jobs and unreferenced objects, while preserving shared bytes and sync tombstones.

- **D-115 — Music sources, delayed collection and fixed retention.** Music saving accepts
  current search results or an accessible playlist, with no transfer flag or global catalog.
  Playlist membership is the retention reference; search discovery authorizes access but does
  not retain songs indefinitely. Durable unreferenced timestamps and job generations prevent
  restart/race resurrection; reattachment cancels pending collection. Per owner clarification,
  song collection is delayed, unlike books. Two independent server constants define audio-cache
  expiry and unreferenced-song grace (both 30 days); remove administrator control of these
  periods. Audio-cache expiry keeps song metadata; song collection removes live metadata,
  discovery/state and file references. No upgrade migration: use fresh development data.

- **D-116 — Offline retention is personal for every target.** Documents, tracks, booklists
  and playlists each support a per-user LWW auto/1–365 day policy with a personal usage
  clock. Policies are private `me:<user>` rows; read access permits changing one's own
  policy. Unset/auto never starts a background download. Applicable item and list policies
  combine by maximum expiry. Personal metadata survives access revocation but never grants
  content access; schedulers and eviction validate current membership and access. Shared
  playlist retention/usage fields and old document policy fields are removed. Existing
  configuration is discarded; only the legacy importer is updated, without a current-app
  schema migration, as explicitly requested before the first launch. Server 30-day orphan
  and audio-cache policies remain independent.

- **D-117 — Recoverable sync transport and isolated operation failures.** Large legal
  revision groups travel as bounded connection-bound continuation fragments, preserving
  atomic row/cursor application. Oversized or failed pushes request authoritative repair.
  Client full pulls serialize with deltas; revocation epochs and session fences stop stale
  restoration. Object ordering keys preserve dependencies while allowing unrelated failed
  queues to progress. Permanent oversize writes fail visibly; read failures after accepted
  writes retain their intent. Download no-progress timeouts preserve durable offsets and
  release stalled network work. Replayed logout clears binding without revoking a newer
  session. Regression tests cover large payloads, races, user isolation and recovery.

- **D-118 — Reconcile pull baselines across shared client storage.** Scope admission is
  per user while persisted scope rows are shared. New admission replaces cached rows/windows
  from a complete pull starting at zero. Existing admission must retain its captured request
  cursor until atomic apply; both external advances and cache-invalidation resets restart
  the pull, with two immediate retries then normal backoff. Keep backwards-chain validation
  and reset progress per attempt. Login regression seeds an unadmitted cached cursor before
  a real paginated pull; the old build fails with the deployed error on Chromium 70.

- **D-119 — Verify in CI after pushing by default.** Per explicit owner instruction on
  2026-10-16, commit and push first, then monitor the exact commit's CI `check` and package
  jobs and repair failures. Full local check/E2E/package runs are not pre-push requirements.
  Local verification is optional for quick reproduction or targeted feedback; regression
  tests and accurate verification reporting remain required. This supersedes earlier
  worktree and main-branch local-gate prerequisites.
