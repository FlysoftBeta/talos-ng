# Server module mechanisms

Per-module design that is not shared kernel machinery. Common conventions (schema, repo,
service, api, `Uow`, scopes) are in `server.md`; rules and offline classification of methods
live in the contract registry.

## Community

Tables `community_conversations`, `community_members`. Conversation metadata and visible
members sync in `conv:<id>`; a private `communitySelf` row in `me:<user>` keeps the user's own
hidden membership. Membership changes run in a `Uow`, drive scope `added`/`gone`, and call a
kernel callback that refreshes chat state and authority grants.

- Exactly one `wild` and one `announcement` system group are seeded at boot; public create
  arguments cannot choose protected types and the type of an ordinary group is immutable.
- Search reveals only discoverable groups whose parent the caller can access; a child can also
  be found through its accessible parent. Joining re-checks the supplied search/parent
  provenance server-side (knowing an id proves nothing). Passwords are random-salt scrypt and
  never enter public metadata or synced rows.
- Hiding membership emits a shared tombstone (so cached identities do not linger) while the
  user's private row remains; it hides the directory, not authors on existing posts.
- DMs use a symmetric pair key so duplicates cannot exist and require a visible non-self
  member of a shared group; existing DMs survive leaving that group.

## Chat

Tables `chat_posts, chat_states, chat_texts, chat_stickers, chat_announcements, chat_ack,
chat_mutes`. `post` rows are a windowed type in `conv:<id>`; `chatState` and
`announcementAck` sync in `me:<user>`, the current announcement in `sys`.

- Posts have immutable id, author, conversation and per-conversation sequence. Edits keep
  identity; deletion keeps the history slot and reply target and drops body and attachment
  references. SQL triggers prevent tombstone resurrection. Synced rows carry a 1,000
  character preview only; page reads include tombstones and cap rows (40) and serialised
  preview bytes (180 KiB, counting escaped control characters) to fit a header.
- **Large text** (limit 5,000,000 UTF-16 units) is staged in queued `text.put` chunks of
  16,000 units and referenced by the post, because JSON-escaped input must fit the transport
  header limit. JSON storage preserves surrogate pairs split across chunks; full bodies are
  served as binary chunks of at most 512 KiB that the client concatenates before decoding
  UTF-8. Posted text is trimmed and must be non-blank; drafts may be whitespace.
- Read cursors merge as Max; pin, mute, draft and retention are LWW with future-clock clamp.
  Posts project last activity and unread info into each member's `me:` scope. Membership loss
  tombstones that conversation's state. Announcement acknowledgement is monotonic by
  revision, so acknowledging an old revision never covers a newer publication; the mute seam
  stores an absolute epoch expiry against the injected clock.
- **Images are thumbnailed on the server** with pure-JS Jimp (PNG/JPEG/GIF/BMP; JPEG
  thumbnail within 480 x 480, quality 82; animated inputs use the first frame). Header checks
  reject excessive dimensions before decoding (32 million pixels, 32,768 per axis, animated
  GIFs also an aggregate pixel and 512-frame cap); decoder concurrency is two. Pure JavaScript
  keeps Windows and Linux on identical code with no native addon or WASM. Original and thumbnail
  references are claimed in the same transaction as the post and released on tombstoning;
  membership, mute and image entitlement are re-checked at commit after the asynchronous work.
- Stickers: the shipped catalogue is copied into the build, seeded as content-addressed
  objects with durable `chat-sticker` ledger references at startup, paged 100 at a time.
- Management actions (mute, delete, announcement publish) are audited; root has management
  powers but never bypasses conversation membership.

## Library, collections

See `documents.md` for import and delivery. State: `libraryState.seconds` holds per-device
monotonic counters summed by the UI, resume is LWW and furthest is Max. Collection rows
deduplicate across personal and shared scopes by latest revision on the client; shared
document rows are admitted only while their collection still lists them. Item removals use
durable tombstones so removals reconcile after disconnection.

Each user has private physical collections marked `builtin: shelf | favourites`; ordinary
collections omit the marker. Provisioning is idempotent and runs before the sync snapshot and
inside default import publication. Built-ins use ordinary collection/item sync and offline
storage, and collection access explicitly excludes all other users regardless of generic grants.
The library rejects built-in deletion and sharing; account purge uses the internal deletion
path. There is no collection metadata-edit endpoint.

`collection.items` only reorders/removes existing members. `collection.transfer` names source,
destination and document; the source must contain the document and allow transfer (owner or
an explicit delegable grant), and the destination must be writable. The client initiates this
command on the source row. External imports retain their destination selector and default to
the user's shelf; permissions are checked again at asynchronous text/file publication.
Generated-text publication rechecks permissions in the source workflow's transactional callback.

Favourite membership lives in the built-in favourites collection. The queueable favourite
command and its LWW register remain the concurrency protocol, not a second access mechanism:
accepted writes update membership and the register in the same UoW. Direct transfers/removals
update that register too; the server generates a stamp later than its previous value. Offline
replay updates every scoped copy of the built-in as well as the register, so the reader and
booklist show the same pending state. The reader advances a new favourite operation beyond the
observed membership stamp even when the device clock is behind. Reconnect rechecks source transfer permission before an
addition. A legitimately transferred favourite is an independent container after source revocation.

All service membership changes reclaim zero-container documents in the same transaction.
Reclamation tombstones document/state/item projections, cancels and clears conversion jobs,
releases object references, and calls application-composed hooks to remove network-source
checkpoints/jobs and collection grants. The outer UoW owns rollback, including purge. Physical
object reclamation runs immediately after commit through the object ledger's publication/GC
sequencer, bypassing orphan grace only for the explicitly released objects; deduplicated objects
with any surviving reference stay intact. Filesystem failures are reported through the existing
post-commit effect reporter and remain eligible for normal GC. Conversion checks document
existence and cancellation before retaining a completed pack, preventing resurrection.

## Netbooks

`NetbooksProvider` splits search, catalog and chapter fetch. The production provider uses
bounded, timeout-controlled official HTTP responses only (no browser automation, third-party
tokens or mirrors); a fake provider is selected only in test-seed servers. Preview-only or
verification-gated chapters fail explicitly instead of producing an incomplete book. The
upstream may demand browser verification and no bypass is attempted, so the live provider is
covered only by an opt-in test (`TALOS_NETBOOKS_LIVE=1`, skipped by default).

- One per-service search lease enforces a five second cooldown; success and busy replies carry
  server time and retry time and the browser converts them to its own clock.
- Downloads re-check the `article_download` gate and write access to the target booklist at
  start, on restart and between chapters. Chapters are fetched sequentially, paced 500 ms,
  with four exponential-backoff retries for transient failures.
- `netbooks_downloads` (catalog, owner/book/target, produced document) and
  `netbooks_chapters` (one checkpoint per complete chapter) are server-only tables; progress
  and results reach the user through the job and library projections. Active requests with
  the same owner/book/target join one job; publication gives every active job for that tuple
  the same document checkpoint, so only one document is created. Chapters are removed after
  publication and cascade on purge. Publication and the checkpoint commit in one
  object-ledger transaction (`importGeneratedText`, up to 200 MiB), then the library
  conversion job renders the reader pack.

## Learning

`learning_words` keeps unique English spellings with stable ids; `learning_corpus` stores one
versioned deflate-packed snapshot in scope `learn`, so one pull makes complete offline practice
possible; imports skip malformed or duplicate entries and publish a new version only when
words were added. `learning_progress` is one product-of-counters row per user and word in
`me:<user>` and the server applies queued answers with the same contract reducer as the client
(merge rules in `sync.md`). Word import and discipline assignment need feature-management
authority; a seed command (`packages/server/bin/learning-seed.ts`) imports a words file into an
existing database with the same rules.

## Media

`MediaProvider {search, resolve, materialise}`; `YtDlpProvider` runs a pinned binary with
bounded output, timeout and cancellation (search uses yt-dlp's native `ytsearch`; audio is
materialised as WebM so MIME matches bytes). The pinned yt-dlp version and per-platform
SHA-256 are in the package manifest and verified at package time; a config entry overrides
the binary path. YouTube player clients are selected by yt-dlp’s upstream defaults;
Talos does not pass a `player_client` extractor override.

- Search commits bounded provider metadata, per-user discovery and the initial
  `unreferenced_since` clock in one UoW. It creates no playlist and has no cumulative
  500-track search limit. Explicit playlists retain their 500-item bound. Public resolve
  only looks up a currently accessible source/provider identity; it cannot ingest arbitrary
  provider IDs. Trusted ingestion can assign a target playlist in the same UoW, or stage
  unreferenced metadata under the same grace clock while an offline import assembles lists.
- **Discovery is authorisation, never retention.** Every track operation and ticket
  redemption needs active per-user discovery or a current owned/granted playlist. Root
  status, favourites, queues and recents do not independently grant track access. Library
  snapshots contain accessible playlist tracks and personal references, not a global catalog
  or every discovered result. The client picker selects current search results or one
  accessible playlist; search rows that disappear from sync cannot remain actionable.
- Music has no delegation flag/table. Read access suffices to copy songs into a writable
  playlist; playlist grants may be shared at the holder's level or below. Only own authority
  may revoke; stronger grants and original-owner access remain protected. Copying before
  revocation establishes a separate playlist path. Shared tracks sync in `coll:<playlist>`;
  discovered tracks and personal state sync in `me:<user>`.
- **Song reclamation is delayed.** `media_tracks.unreferenced_since` is nullable and durable.
  New unreferenced tracks get the injected current time. Membership writes clear it while
  any live playlist reference exists; the last removal sets it only if not already set.
  Search, playback, favourites, queue writes and unrelated playlist edits do not restart it.
  Reattachment cancels reclamation, including at the deadline if its transaction wins first.
- Server media defines two independent hardcoded durations in `retention-policy.ts`:
  `AUDIO_CACHE_EXPIRY_MS` and `UNREFERENCED_SONG_GRACE_MS`, each 30 days. Neither is
  administrator-configurable. The scheduled `media.evict()` pass uses the song grace to
  reclaim live tracks with `unreferenced_since <= now - UNREFERENCED_SONG_GRACE_MS` in
  batches of 100 (bounded sync revisions), rechecking that no live membership exists in
  the same synchronous writer transaction. Owner purge uses the same membership
  transitions; another owner's saved copy survives.
- Reclamation releases audio/cover ledger references, tombstones the track and each
  discovery, prunes favourites/queue/recents, and publishes scoped sync tombstones atomically.
  Identity/tombstone rows remain for sync and provider deduplication. Rediscovery
  revives only the searching user's discovery. A durable track generation changes on revival;
  materialisation jobs check that generation both before work and during object publication,
  preventing late jobs from resurrecting reclaimed audio. Objects with other owners remain
  protected by the ledger; physical deletion follows its normal sweep.
- Independent audio-cache eviction drops audio references with
  `last_played <= now - AUDIO_CACHE_EXPIRY_MS`, even for playlist members;
  referenced metadata stays and a later play re-materialises. Playback/retention use the
  bounded `media.materialise` job and publish audio into the ledger before advertising its
  hash. The volume cap is returned with every playback RPC.
- The schema assumes a fresh database/dev reset; an upgrade migration for previous media
  discovery/delegation schemas is intentionally outside this implementation.

## AI

Private scopes: `ai:<conversation>` carries windowed messages, `me:<user>` lists, LWW drafts
and credits. Model output checkpoints fan out as subscribed `sync.delta`; reconnect pulls
and explicit pages repair gaps; previews fit the sync byte budget and full UTF-8 text/images
are fetched as binary.

- Provider: the first model in the config directory's `model.json` (`baseURL`, `key`, `models` with credit
  prices per million tokens) must support the Responses protocol with text, images and tools.
  Requests use `/responses`, `store:false`, SSE and a hashed safety identifier, no SDK. Keys
  and upstream error bodies never enter synced rows; missing or invalid configuration
  disables sending but keeps history and drafts. A deterministic fake provider is injected
  only with the guarded test-seed option.
- Runs are `ai.run` jobs (four global, two active per user, one per conversation; 120 s
  deadline; at most eight tool rounds plus a final answer round). **A disconnect never
  cancels a run.** Queued runs resume after restart; an interrupted upstream stream is marked
  failed with its partial text and checkpointed consumption and is not replayed, so tools are
  never duplicated and visible output is never contradicted. Retrying is a new send.
- **Credits are transactional.** Integer microcredit reservations cover bounded tool rounds
  and output and pin the plan allocation (UTC day and Monday-week windows) at reservation
  time, also across midnight; settlement uses reported cached/input/output usage (interrupted
  runs use visible-byte estimates), happens once and is capped at the reservation, in the
  same `Uow` as the message state. Plans extend from their current end; top-ups carry
  permanent fingerprinted idempotency keys; batch top-ups from the workbench reuse stable
  keys per user and retry only failures.
- **Workspace**: logical SQLite BLOB files (10 MiB, 256 files including images), part of
  ordinary backups; no host paths, archive extraction or code execution. Names allow at
  most two directories and reject traversal, Windows aliases, hidden names, separators,
  alternate data streams, percent encoding and control characters. Mutations use exact
  revision preconditions and tool-call journals so they are atomic and idempotent. Tools:
  `list_files, read_file, create_file, replace_text, delete_file` (replacement needs 1-100
  matches). SVG passes a narrow inert element/attribute whitelist and previews render in image
  contexts only. Images need matching magic bytes (PNG/JPEG/GIF/WebP, 5 MiB, four per message).
- No classifier, paid tag search or implicit model fallback; the ancestry up to a 512 KiB
  context bound is sent, beyond that the user is told to start a new conversation instead
  of lossy compaction. Long input goes through ordered 16,000 unit staging chunks (100,000
  character limit).

## Admin

Online-only paged workbench queries against SQLite (escaped LIKE patterns; owners filter,
count and stably sort **before** paging, no overlay filters a sliced page). Admin owns
`admin_settings`, `admin_downloads`, `admin_announcement_revisions`; users, devices and
invitations belong to identity, effective access to authority, group paging to community,
mute projections and acknowledgement counts to chat. Bulk user changes evaluate each target
independently, return a per-user result and audit both the batch and each successful field
change. Reserved system group types cannot be created or promoted in the editor. Settings
include the media volume cap consumed by media. Diagnostics consume kernel
query ports and own authorisation of generated downloads (incident ZIP).

## Ops

Online-only, 19 contract methods, none in the outbox. Tables `ops_settings, ops_backups,
ops_office, ops_downloads`.

- **Backups** are independent complete snapshots (no incremental chains): `Db.backupTo` takes
  the consistent online snapshot, the objects ledger holds its GC sequencer while every
  object recorded in that snapshot is copied incrementally, and each `<id>.backup/` holds
  `talos.db`, a linewise `backup.ndjson` (size and SHA-256 per file) and `objects/<sha256>`
  copies. No configured size cap exists: bytes are processed in 64 KiB chunks and rows by
  iterators; sparse zero extents are preserved; a failed object copy never publishes a
  backup. A multi-GiB test (33 synthetic 64 MiB objects) bounds peak RSS growth to 256 MiB.
  Default retention five (1-100); a daily `ops.backup.daily` job runs once per Beijing
  calendar day and catches up a missed day after startup; manual creation is guarded
  against overlap. The 512 MiB limit applies only to release-update ZIPs.
- **Download** streams a Talos v2 framed archive (`TALOS-BACKUP-2\n`, then per file a JSON
  `{path,size,sha256}` line, exactly `size` bytes and LF, ending `END\n`) directly through
  the gateway; range requests answer 416.
- **Restore** is a CLI of the server bundle (`server.js restore <archive or .backup dir>`)
  run with the launcher stopped. It refuses a live server lock, verifies all hashes, SQLite
  integrity, foreign keys and ledger completeness before touching anything, publishes
  immutable objects first, keeps the checkpointed previous database as
  `data/before-restore.db`, then replaces the database. It never deletes unrelated objects.
  Backups exclude configuration, TLS keys and logs.
- **Updates**: update ZIP uploaded with `upload.*` then `ops.update.stage` (must belong to the
  caller); staging verifies hashes, creates and pins a full rollback snapshot and does not
  touch the running process. `apply` queues its reply before signalling the launcher.
  Cloud `install` uses the same prepare operation under one guard; automatic checks run at
  most every 15 minutes when enabled; install is explicit. A staged-but-unapplied release
  is not applied after a process restart. Confirmation window and rollback: `packaging.md`.
- **Host tools** use fixed `execFile` argv, never a shell; Windows shutdown has a 10 s grace;
  other platforms answer `E_UNAVAILABLE`.
- **Office capture** (Windows) enumerates COM active objects for Word, PowerPoint, Excel and
  the WPS equivalents behind an injectable adapter, copies saved disk contents only (size
  and mtime checked before and after), refs go through the ledger, bytes and names dedupe.
  Polling every four seconds; clearing keeps the in-memory open-document set so the next
  poll does not undo it, explicit capture can re-add; limits 1,000 entries, 100 MiB per file,
  256 MiB per poll. The COM path has not run on native Windows.
