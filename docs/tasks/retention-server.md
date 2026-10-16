# Personal offline retention — server and importer

Implement independent user-owned offline policies for books, booklists, songs and
playlists. Collection sharing must never impose local downloads on another user.
Own contracts, server library/media domains and the old-version importer; coordinate
client models with the retention-client task. Do not add a deployed-app migration.

## Decisions and implementation

- `libraryRetention` and `mediaRetention` rows belong to `(authenticated user, target
  id)`. The target kind is `doc` / `collection` or `track` / `playlist`. IDs are the
  existing globally generated entity IDs. New tables are created in fresh schemas.
- Each row has `value: {v: "auto" | integer days (1–365), t, op} | null` and a
  monotonic personal `lastUsed`. A null value means usage has been recorded without
  an explicit policy. `auto` clears explicit retention without deleting its LWW
  register, so an older offline operation cannot resurrect a cleared policy.
- Queued setters are `library.retention.set` and `media.retention.set`, with
  `{kind,id,value}`. The user always comes from the authenticated context. Read
  access and the existing offline feature entitlement suffice; editing or owning
  the shared collection is unnecessary. Extra user fields are rejected.
- Personal policies and clocks sync only in `me:<user>`. Collection scopes carry
  no retention. Own policies remain visible after a target is revoked, like reading
  preferences; they contain no target content or another user's data. Client
  eligibility requires current target access, including immediate collection-scope
  revocation. Retaining the own record allows grant/search restoration without
  fabricated revisions or missed updates after a same-revision grant/track push.
  A personal policy never grants access.
- Reading progress updates the book clock. Queued
  `library.collection.recordRead`, `media.track.recordPlay` and
  `media.playlist.recordPlay` update only the actor's clocks. Online track playback
  also updates that actor's clock. Usage cannot move backwards and is capped at
  server time plus the shared five-minute future-skew tolerance. Policy LWW stamps
  use the same clamp to prevent far-future operations permanently dominating.
- The client interprets explicit duration from the later of policy timestamp and
  personal usage. It combines its own active item/list requirements; auto adds no
  forced prefetch. LibraryState.retention and shared playlist retentionDays and
  lastPlayed were removed rather than preserved as compatibility configuration.
- Server orphan-song reclamation and server audio-cache eviction retain their
  independent fixed 30-day policies. Personal settings do not change these clocks
  or shared lifetime rules. User purge removes the new personal records.
- The old-version importer ignores shared playlist retention_days/expires_at and
  creates no personal policies from them. Imported media metadata and ordered
  membership remain intact. No new-app data migration is supplied.

## Verification

- Server production and test typechecks and migration-tool typecheck pass.
- Contract compatibility probe passes: ES2018 syntax, Chrome 70 API scan and all
  155 registered method fixtures.
- Library, media, media API availability and migration tests exercise two-user
  read-only sharing, four target types, default auto, independent values and clocks,
  equal-stamp operation tie-breaking, stale operations, explicit auto reset,
  forbidden injected actor, private scope projection, revoke/regrant, and ignoring
  legacy shared configuration.
- Existing lifecycle tests verify fixed server retention behavior independently.
- Full integrated client/e2e/package gates remain the orchestrator's responsibility.
