# Legacy data migration

This guide covers the `classapp-next` SQLite `data.db` and its `storage/objects` tree. The legacy application must be stopped before making a consistent copy. Its built-in SQLite-only backup omits blobs and cannot serve as the sole rollback copy.

## Operator procedure

**Release usage (operators).** Every release carries the importer as a self-contained `versions/<build>/migrate.js` (also in the `-update.zip`), run by the bundled runtime; no repository, pnpm or TypeScript flags are needed. From the install root use `runtime/node --disable-warning=ExperimentalWarning versions/<current>/migrate.js` (Windows `runtime\node.exe`; `<current>` is the build named in the `versions/current` pointer file) in place of `node tools/migrate/bin/migrate.mjs` in the commands below, e.g. `runtime/node --disable-warning=ExperimentalWarning versions/<current>/migrate.js inspect --source /backup/data.db --blobs /backup/storage/objects`. Relative `--source`/`--blobs`/`--target` paths resolve against the caller's working directory. Releases ship no wrapper script for it (the install root holds only the start script). After `verify`, stop the launcher, replace the install's data directory (`data/` unless `config.json` moves it) with the migrated (empty-then-filled) target directory and start. `--disable-warning=ExperimentalWarning` silences the `node:sqlite` notice.

**Developer usage.** Run the commands below from the repository root with Node.js 24.18+ (24.x) and the workspace dependencies installed. The source wrapper registers the workspace-pinned `tsx` loader in-process because its transitive imports contain TypeScript parameter properties; CLI arguments, signals and exit status belong to that same process (`tools/migrate/build.mjs` produces the bundle `tools/migrate/dist/migrate.js`, which `pnpm package` copies into each release). `inspect` includes the actual table/column inventory, `config.schema_version`, and any connection-local compatibility views. Schema v27/v28 use the current mapping; v25/v26 text libraries, bookmarks, group collections and personal queues use read-only views. The source database is never upgraded. **Do not run the legacy v25→v26 upgrade as migration preparation:** it deletes path-based binary records and storage. v25 databases containing media assets or non-text articles are rejected for separate recovery; their old path-based blobs are not supported by this importer.


1. Stop writes to the legacy application. Copy **both** `data.db` (including a consistent WAL snapshot) and the entire `storage/objects` directory to offline backup storage. Record their sizes and a checksum manifest. Preserve the old application and its config.
2. Dry run against the copy:

   ```text
   node tools/migrate/bin/migrate.mjs inspect --source /backup/data.db --blobs /backup/storage/objects
   ```

   Review counts, duplicate handles, orphan rows, replacement characters, long text and missing blobs. `inspect` opens SQLite read-only and does not create target files.
3. Choose an empty new data directory. Run:

   ```text
   node tools/migrate/bin/migrate.mjs run --source /backup/data.db --blobs /backup/storage/objects --target /srv/talos-data
   ```

   The target must be empty. If interrupted, use the same source and `--resume`. A different source fingerprint is rejected. Resume with the same importer revision; after upgrading importer code, start fresh because journaled rows are not replayed. Do not edit `migration_map` or `migration_meta`.
4. Check the generated `migration-report.md`, then run:

   ```text
   node tools/migrate/bin/migrate.mjs verify --source /backup/data.db --blobs /backup/storage/objects --target /srv/talos-data
   node tools/migrate/bin/migrate.mjs report --source /backup/data.db --target /srv/talos-data
   ```

   `verify` exits 1 if there are any mismatches, recorded row issues, or failed conversions—even when all entity and byte checks pass. Separate `mismatches`, `issues`, and `failedConversions` when reviewing its JSON; a deliberate fallback still needs operator review. `report` writes its report to stdout; `run` writes `migration-report.md` in the target.

   `verify` checks client-schema validity for chat and reading state, author names and latest-message previews, plus journal counts, target counts for one-to-one entities, source row hashes, per-entity target counts (including many-to-one and explicitly excluded rows), and deterministic first/middle/last content samples. Document body/source bytes, post text and audio/image blobs are SHA-256 compared against source bytes, the content-addressed store and the ledger. Workspace files are checked in bounded chunks; AI balance totals and individual accounts must match exactly. It cannot prove every item correct. A row with an issue is still journaled. Treat every issue as requiring review.
5. Boot the new server on the migrated data directory. It runs queued `library.convert` jobs through `@talos/docpipe`. Check failed jobs, document readability, a sample of images and media object integrity. Log in with a migrated six-digit PIN; first successful login replaces the legacy HMAC record with scrypt.
6. Roll back by stopping the new server and starting the untouched legacy application with the original **database and object tree**. Never point the legacy application at the new data directory. Keep the backup until reconciliation and cutover checks are complete.

## Mapping

Legacy IDs become deterministic target ULIDs, except wild/announcement groups that reuse the target’s seeded system-group IDs; `migration_map` records every legacy ID, new ID and source hash. Epoch-millisecond target times are parsed from legacy SQLite UTC datetime text. A malformed timestamp becomes `0` and should be reviewed.

| Legacy source | Talos target | Loss or qualification |
|---|---|---|
| `config.pin_secret`, `user_pins` | `secrets.pin_hmac`, `user_pins` | Legacy HMAC is verified using the printable hex secret and rehashed after login. The secret is sensitive; protect the target backup. |
| `users`, `user_admin_roles`, `deleted_users` | `users`, profile roles/features/deleted | Feature bits map in the same nine-feature order. Role dependencies add `administrator`. Duplicate case-insensitive handles get a numeric suffix. Names are capped at 30 characters. |
| `clients`, `ghost_users`, `config.whitelist_enabled`, `config.system_locked`, `config.idle_lock_enabled` | `devices`, `invitations`, `identity_policy` | Admission policy flags carry over. Device history, IP associations and expired session tokens are not transferred. Invitation expiry is retained; onboarding tokens are not. Legacy MAC identity signals have no new equivalent. |
| `groups`, `group_members`, `dms` | `community_conversations`, `community_members` | Wild and announcement groups map to seeded target system groups. Hierarchy is linked after import; orphan memberships are reported. Group password hashes carry over as metadata but have not been reverified against the target password flow. |
| `posts` | `chat_posts` | Full text, replies, edits, tombstones, sticker catalog references and source timestamps carry over. Preview is truncated to 1,000 characters. Missing target sticker catalog entries are reported. |
| `post_images`, `post_image_thumbs` | `objects`, `object_refs`, `chat_posts.image` | Original bytes stream into the ledger. Existing thumbnail bytes are discarded and JPEG thumbnails regenerated. Staged images without posts are reported. |
| `convs_user` | `chat_states` | Latest-message previews are rebuilt after attachments. Read post ID becomes sequence; pin, mute and draft stamps are inferred from legacy update times. Legacy retention defaults to `auto`. |
| `config.announcement_*`, `users.is_muted` | `chat_announcements`, `chat_mutes` | Announcement publish time is unavailable and becomes `0`. Indefinite mutes use the maximum safe epoch time. |
| `articles`, `text_article_segments` | `library_documents`, source objects, `library.convert` jobs | Text remains text, with segment bytes streamed to a source object. PDF source is retained and re-rendered by `@talos/docpipe` on server boot. Missing blobs and conversion failures are reported, not fatal. |
| `booklists`, `booklist_items`, `group_booklists`, `access_bindings` | `library_collections`, `library_items`, `authority_grants` and projections | Direct user owner grants select the collection owner; collections with only group/no ownership and ownerless articles use the earliest imported user and record the ownership loss. Grants become `coll:<id>` read/write/own authority grants plus module delegations. Mixed shareable-read/non-shareable-write retains write without delegation to avoid escalation. Collections over 1,000 documents retain extra item rows but expose only the first 1,000 in the collection body. |
| `user_favorites`, `article_read_progress` | `library_states` | Article favorite and progress import. A legacy flat offset maps to unit 0; per-device detail is unavailable. Track favourites and personal queues use `media_user_states`. Other unsupported kinds are reported. |
| `words`, `user_word_progress` | not migrated | The vocabulary-practice feature was removed; legacy words and progress are left in the source. |
| `ai_conversations`, `ai_messages` | `ai_rows`, `ai_messages` | Titles, messages, sequences and read cursors carry over. Finished messages remain done. Pending/streaming messages become cancelled/failed with partial text and a migration error. Image attachments resolve against validated workspace files; missing files are reported. Fork topology and derived tags are not reconstructed. |
| `ai_credit_accounts`, `ai_plan_enrollments`, `ai_credit_ledger` | `ai_accounts`, `ai_ledger` | Top-up balance, plan end and ledger records carry over. Active reservations are closed without a charge, with zero-amount release notes naming the reserved amount; top-up balances are unchanged. Historical usage accounting is not reconstructed. |
| `ai_workspaces` | `migration_workspace_rows`, `objects`, `object_refs`, `ai_files` | The ZIP is retained and validated entries are streamed through temporary files into `ai_files` without a whole archive or file buffer in JavaScript. Per-file modification times have no target column. Archives exceeding the target's 10 MiB / 256 file limit, missing blobs and invalid entries are reported. SQLite's BLOB concatenation can still allocate a whole value internally. |
| `media_tracks`, `media_assets`, `media_lists`, `media_list_items`, `user_queues`, media favorites | `media_tracks`, `media_playlists`, `media_user_states`, `objects`, `object_refs` | Real module writes, no adapter. Audio checks SHA-256 and byte count before publication. Covers stay ledger-owned because target tracks have no cover field. Queue/playlist order is retained. Legacy shared retention and expiry are discarded; personal offline policies default to `auto`. Lists over 500 tracks are reported and not silently truncated. |
| Audit and incident tables | none | Operational diagnostics are excluded. Preserve the legacy backup if historical access is needed. |

The generated report lists row-level errors. Do not treat a journal count that matches the source count as proof that every target entity is usable.

## Sharing and access reconciliation

The original `{mode:"owner"}`, `{mode:"readwrite",shareable}`, and `{mode:"read",shareable}` grant sets map to `own`, `write`, and `read`. User and group projections are regenerated through authority. An owner path permits delegation. A non-owner path delegates only when the legacy grant at the retained level is shareable. The target stores one delegation bit; a shareable-read path combined with a non-shareable-write path loses read-only delegation and is listed as an issue. Group ownership remains an own grant, while the target requires one user owner. Multiple user owners retain their own grants, but the first legacy user-owner path becomes the immutable collection owner. Ownerless fallback ownership is reported.

The design deliberately replaces possession-token access: `resource_possession` tokens, expiries and provenance never become enduring grants. Access to documents/tracks is recovered through currently readable containing collections; favourites confer no authority. Token-only access without a surviving collection path is lost and every possession row is reported. Legacy stream tickets and login sessions are not portable and are not imported.

Downloaded network novels already live in `articles`/`text_article_segments`; they become ordinary text library documents and durable conversion jobs. They have no continuing download/provider identity. Bundle sources whose MIME is text use a text filename, not a PDF filename. Rendered legacy archives are discarded and regenerated from source.

Active AI runs are never replayed: partial text is preserved, pending/running statuses become cancelled/failed, reservation holds settle to zero without charging or crediting top-up. Historical ledger deltas remain exact; migration release notes carry amount zero so the historical delta sum is unchanged. Workspace staging ZIPs are omitted because they are unpublished transactions. Valid files and ZIPs are retained as immutable objects and bounded `ai_files` content. Per-file modification times and legacy message attachment display names have no target column. Workspace path references use the final legacy workspace snapshot; missing or changed attachment metadata is reported rather than guessed.

## Importer design

- The source database is opened read-only with `query_only`; schema v25/v26 data
  (bookmarks, group article collections, owned queues) is read through connection-local views
  rather than a destructive legacy upgrade, and unsupported v25 path-based binary data fails
  before the target is created. The target uses the server `Db` adapter and a real kernel,
  reached only through the `@talos/server/migration` subpath (`createKernel`, `Db`, `Uow`,
  `ObjectLedger`, `IdentityService`); the boundary rules reject any other server import and
  nothing in server `src/` imports the tool.
- A per-row journal (`migration_map`, `migration_meta`) records the source hash and the stable
  legacy-to-ULID map; batches of at most 500 source rows commit independently, which is what
  makes `--resume` safe. Users and PINs bootstrap before the kernel starts; later batches run
  inside the kernel's `Uow`, so nested service imports keep revision and transaction
  invariants. `TALOS_MIGRATE_STOP_AFTER_BATCH` is a test failpoint.
- The legacy PIN HMAC secret is carried over (identity accepts the printable-hex key and
  upgrades to scrypt on login), so the source secret is required. Legacy UUIDs become
  deterministic ULIDs whose time prefix encodes zero; original creation times live in the
  timestamp fields.
- Blobs stream into the content-addressed store (bulk batches, see `objects.md`); text and PDF
  documents queue durable `library.convert` jobs for the next server boot; sticker references
  resolve against the seeded catalogue; media uses the real module import seam and requires the
  legacy SHA-256 and size to match before audio attaches; missing or corrupt content stays a
  reported issue, never a fabricated asset.
- Verification compares journal counts, per-entity target footprints, deterministic
  first/middle/last samples, every imported workspace file checksum and exact per-user credit
  balances, and also decodes client-visible state (reading state, chat summaries),
  not only SQL and byte counts. Any mismatch, issue or failed conversion yields a nonzero
  exit code. Private rehearsal artefacts stay outside the repository.
- The tool is a one-shot offline pipeline (read, map, materialise) and is deliberately not
  regrouped by domain.

## Complete current SQL column inventory

This inventory covers the current schema, including tables intentionally excluded. Historical `_v27`, `_split`, `_generic`, `_hold` tables are transient upgrade scaffolding, not input entities. All imported rows also have their complete source-row hash in `migration_map`; a hash does not preserve omitted column values. Target revisions are regenerated. All `not migrated` cells give the reason; keep the complete source backup for those values.

| Legacy table.column | Target / reason |
|---|---|
| `config.key` | selects pin_secret, whitelist_enabled, system_locked, idle_lock_enabled and announcement content/revision; other settings not migrated because target policy/config differs |
| `config.value` | selected identity secrets/policy and chat announcement values; other values not migrated because target configuration is separately provisioned |
| `users.id` | users.id (stable ULID) |
| `users.handle` | users.handle (20-character cap, collision suffix) |
| `users.username` | users.name (30-character cap) |
| `users.profile_revision` | not migrated because target global revisions are regenerated |
| `users.feature_bitset` | users.features (legacy bit order; the retired learning bit is dropped) |
| `users.is_muted` | chat_mutes |
| `users.muted_until` | chat_mutes.until (indefinite becomes maximum safe epoch) |
| `users.banned_until` | users.banned (non-null becomes banned; timed expiry not preserved) |
| `users.created_at` | users.created |
| `user_admin_roles.user_id` | users.roles |
| `user_admin_roles.role` | users.roles (administrator dependency added) |
| `user_admin_roles.granted_by` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `user_admin_roles.granted_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `admin_audit_log.id` | not migrated because operational audit history is intentionally excluded |
| `admin_audit_log.actor_id` | not migrated because operational audit history is intentionally excluded |
| `admin_audit_log.action` | not migrated because operational audit history is intentionally excluded |
| `admin_audit_log.target_kind` | not migrated because operational audit history is intentionally excluded |
| `admin_audit_log.target_id` | not migrated because operational audit history is intentionally excluded |
| `admin_audit_log.details_json` | not migrated because operational audit history is intentionally excluded |
| `admin_audit_log.created_at` | not migrated because operational audit history is intentionally excluded |
| `deleted_users.id` | users.deleted |
| `deleted_users.username` | not migrated because the users profile supplies the name |
| `deleted_users.deleted_at` | not migrated because target deletion marker has no historical timestamp |
| `user_pins.id` | not migrated because target entity omits this legacy metadata/relationship; source-row hash alone is retained, not the value |
| `user_pins.user_id` | user_pins.user_id |
| `user_pins.pin_hash` | legacy HMAC user_pins.hash; upgraded after login |
| `user_pins.created_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `clients.id` | devices.id |
| `clients.konami_locked` | devices.locked |
| `clients.persistent` | devices.persistent |
| `clients.remark` | devices.label |
| `clients.whitelisted` | devices.whitelisted |
| `clients.bound_user_id` | devices.bound_user |
| `clients.created_at` | devices.last_seen (historical last activity unavailable) |
| `client_ips.client_id` | not migrated because historical IP signals are not browser device identity |
| `client_ips.ip` | not migrated because historical IP signals are not browser device identity |
| `client_ips.first_seen` | not migrated because historical IP signals are not browser device identity |
| `client_ips.last_seen` | not migrated because historical IP signals are not browser device identity |
| `client_associations.id` | not migrated because legacy MAC/IP/User-Agent identity matching is replaced by stable browser device IDs |
| `client_associations.client_id` | not migrated because legacy MAC/IP/User-Agent identity matching is replaced by stable browser device IDs |
| `client_associations.mac` | not migrated because legacy MAC/IP/User-Agent identity matching is replaced by stable browser device IDs |
| `client_associations.ip` | not migrated because legacy MAC/IP/User-Agent identity matching is replaced by stable browser device IDs |
| `client_associations.user_agent` | not migrated because legacy MAC/IP/User-Agent identity matching is replaced by stable browser device IDs |
| `client_associations.first_seen` | not migrated because legacy MAC/IP/User-Agent identity matching is replaced by stable browser device IDs |
| `client_associations.last_seen` | not migrated because legacy MAC/IP/User-Agent identity matching is replaced by stable browser device IDs |
| `client_attempts.client_id` | not migrated because authentication throttling is reset on cutover |
| `client_attempts.attempts` | not migrated because authentication throttling is reset on cutover |
| `client_attempts.throttled_until` | not migrated because authentication throttling is reset on cutover |
| `sessions.token` | not migrated because login sessions must be re-established against the target |
| `sessions.user_id` | not migrated because login sessions must be re-established against the target |
| `sessions.client_id` | not migrated because login sessions must be re-established against the target |
| `sessions.created_at` | not migrated because login sessions must be re-established against the target |
| `groups.id` | community_conversations.id; system groups map to seeded singleton IDs |
| `groups.conv_id` | derived target conversation ID |
| `groups.revision` | not migrated because target global revisions are regenerated |
| `groups.handle` | community_conversations.handle (collision suffix) |
| `groups.name` | community_conversations.name |
| `groups.discoverable` | community_conversations.discoverable |
| `groups.password_hash` | community_conversations.password (legacy hash retained) |
| `groups.type` | community_conversations.type |
| `groups.members_hidden` | community_conversations.members_hidden |
| `groups.admin_only` | community_conversations.admin_only |
| `groups.no_leave` | community_conversations.no_leave |
| `groups.parent_group_id` | community_conversations.parent after hierarchy linking |
| `groups.created_at` | community_conversations.created |
| `group_members.group_id` | community_members.conversation |
| `group_members.user_id` | community_members.user |
| `group_members.joined_at` | community_members.joined |
| `group_members.hide_self` | community_members.hide_self |
| `dms.id` | community_conversations.id |
| `dms.conv_id` | derived conversation ID |
| `dms.revision` | not migrated because target global revisions are regenerated |
| `dms.peer_a` | community_conversations.peers |
| `dms.peer_b` | community_conversations.peers |
| `dms.proof_group_id` | not migrated because current discovery/membership authority replaces historical proof |
| `dms.created_at` | community_conversations.created |
| `posts.sequence` | chat_posts.seq |
| `posts.id` | chat_posts.id |
| `posts.conv_id` | chat_posts.conversation |
| `posts.revision` | not migrated because target global revisions are regenerated |
| `posts.author_id` | chat_posts.author (missing authors use deleted-user marker) |
| `posts.brief` | chat_posts.body; preview capped at 1,000 characters |
| `posts.content_json` | chat_posts.data kind/sticker/tombstone references; full text comes from brief |
| `posts.reply_to` | chat_posts.data.replyTo |
| `posts.deleted_at` | chat_posts.data.deletedAt + tombstone |
| `posts.edited_at` | chat_posts.data.edited |
| `posts.created_at` | chat_posts.data.created |
| `user_config.user_id` | not migrated because legacy preference keys do not have a migration contract; target preferences use new schemas |
| `user_config.key` | not migrated because legacy preference keys do not have a migration contract; target preferences use new schemas |
| `user_config.value` | not migrated because legacy preference keys do not have a migration contract; target preferences use new schemas |
| `user_config.updated_at` | not migrated because legacy preference keys do not have a migration contract; target preferences use new schemas |
| `user_config.updated_at_ms` | not migrated because legacy preference keys do not have a migration contract; target preferences use new schemas |
| `ghost_users.id` | invitations.id |
| `ghost_users.pin_hash` | invitations.pin_hash |
| `ghost_users.oobe_token` | not migrated because onboarding tokens are not portable |
| `ghost_users.oobe_expires` | invitations.expires |
| `ghost_users.created_at` | invitations.created |
| `articles.id` | library_documents.id |
| `articles.user_id` | library_documents.owner; ownerless rows get reported fallback ownership |
| `articles.title` | library_documents.body.title (200-character cap) |
| `articles.provider_json` | source_file/source_mime choose original blob/converter; text uses ordered segments; archive_file and legacy render metadata not migrated because docpipe regenerates rendition |
| `articles.created_at` | library_documents.body.created |
| `text_article_segments.article_id` | migration_text_segments.article_id / document source |
| `text_article_segments.segment_index` | source segment order |
| `text_article_segments.start_offset` | not migrated because target docpipe computes unit positions |
| `text_article_segments.char_count` | not migrated because target docpipe computes character counts |
| `text_article_segments.content` | streamed UTF-8 library source object |
| `teach_documents.id` | not migrated because Office capture snapshots belong to the new ops capture lifecycle; retain legacy originals in backup |
| `teach_documents.application` | not migrated because Office capture snapshots belong to the new ops capture lifecycle; retain legacy originals in backup |
| `teach_documents.document_type` | not migrated because Office capture snapshots belong to the new ops capture lifecycle; retain legacy originals in backup |
| `teach_documents.name` | not migrated because Office capture snapshots belong to the new ops capture lifecycle; retain legacy originals in backup |
| `teach_documents.blob_id` | not migrated because Office capture snapshots belong to the new ops capture lifecycle; retain legacy originals in backup |
| `teach_documents.file_size` | not migrated because Office capture snapshots belong to the new ops capture lifecycle; retain legacy originals in backup |
| `teach_documents.status` | not migrated because Office capture snapshots belong to the new ops capture lifecycle; retain legacy originals in backup |
| `teach_documents.created_at` | not migrated because Office capture snapshots belong to the new ops capture lifecycle; retain legacy originals in backup |
| `article_read_progress.user_id` | library_states.user_id |
| `article_read_progress.article_id` | library_states.id |
| `article_read_progress.offset` | resume unit 0 offset + furthest |
| `article_read_progress.locator` | not migrated because legacy locators cannot identify regenerated TDP units |
| `article_read_progress.total_read_seconds` | seconds.legacy |
| `article_read_progress.updated_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `article_read_progress.updated_at_ms` | resume stamp and lastRead |
| `client_last_active.client_id` | not migrated because historical activity caches are rebuilt |
| `client_last_active.last_at` | not migrated because historical activity caches are rebuilt |
| `convs_user.user_id` | chat_states.user |
| `convs_user.conv_id` | chat_states.conversation |
| `convs_user.last_read_post_id` | chat_states.readSeq |
| `convs_user.pinned_at` | chat_states.pin.v |
| `convs_user.pinned_updated_at_ms` | chat_states.pin.t |
| `convs_user.compose_draft` | chat_states.draft (16,000-character limit) |
| `convs_user.compose_draft_updated_at` | chat_states.draft.t |
| `convs_user.muted` | chat_states.mute.v |
| `convs_user.read_updated_at_ms` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `convs_user.muted_updated_at_ms` | chat_states.mute.t |
| `convs_user.updated_at` | chat_states.updated |
| `incident_groups.id` | not migrated because operational incident diagnostics are intentionally excluded |
| `incident_groups.environment` | not migrated because operational incident diagnostics are intentionally excluded |
| `incident_groups.build_id` | not migrated because operational incident diagnostics are intentionally excluded |
| `incident_groups.fingerprint` | not migrated because operational incident diagnostics are intentionally excluded |
| `incident_groups.top_frame` | not migrated because operational incident diagnostics are intentionally excluded |
| `incident_groups.occurrence_count` | not migrated because operational incident diagnostics are intentionally excluded |
| `incident_groups.stored_detail_count` | not migrated because operational incident diagnostics are intentionally excluded |
| `incident_groups.first_at` | not migrated because operational incident diagnostics are intentionally excluded |
| `incident_groups.last_at` | not migrated because operational incident diagnostics are intentionally excluded |
| `incidents.id` | not migrated because operational incident diagnostics are intentionally excluded |
| `incidents.public_id` | not migrated because operational incident diagnostics are intentionally excluded |
| `incidents.group_id` | not migrated because operational incident diagnostics are intentionally excluded |
| `incidents.occurred_at` | not migrated because operational incident diagnostics are intentionally excluded |
| `incidents.error_name` | not migrated because operational incident diagnostics are intentionally excluded |
| `incidents.message` | not migrated because operational incident diagnostics are intentionally excluded |
| `incidents.stack` | not migrated because operational incident diagnostics are intentionally excluded |
| `incidents.context_json` | not migrated because operational incident diagnostics are intentionally excluded |
| `incidents.related_incident_ids_json` | not migrated because operational incident diagnostics are intentionally excluded |
| `ai_conversations.id` | ai_rows.id |
| `ai_conversations.user_id` | ai_rows.user |
| `ai_conversations.title` | ai_rows.data.title |
| `ai_conversations.title_norm` | not migrated because target entity omits this legacy metadata/relationship; source-row hash alone is retained, not the value |
| `ai_conversations.active_leaf_message_id` | not migrated because target entity omits this legacy metadata/relationship; source-row hash alone is retained, not the value |
| `ai_conversations.forked_from_conversation_id` | not migrated because target entity omits this legacy metadata/relationship; source-row hash alone is retained, not the value |
| `ai_conversations.forked_from_message_id` | not migrated because target entity omits this legacy metadata/relationship; source-row hash alone is retained, not the value |
| `ai_conversations.last_assistant_sequence` | lastSeq |
| `ai_conversations.last_read_assistant_sequence` | readSeq |
| `ai_conversations.archived_at` | not migrated because target entity omits this legacy metadata/relationship; source-row hash alone is retained, not the value |
| `ai_conversations.created_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `ai_conversations.updated_at` | updated |
| `ai_messages.sequence` | ai_messages.seq |
| `ai_messages.id` | ai_messages.id |
| `ai_messages.conversation_id` | ai_messages.conversation |
| `ai_messages.parent_message_id` | not migrated because target entity omits this legacy metadata/relationship; source-row hash alone is retained, not the value |
| `ai_messages.role` | ai_messages.data.role |
| `ai_messages.content` | ai_messages.data.text |
| `ai_messages.attachments_json` | images resolved from ai_files paths; display names omitted because target image has no name |
| `ai_messages.status` | completed→done, pending→cancelled, streaming→failed; partial content retained |
| `ai_messages.run_id` | not migrated because target entity omits this legacy metadata/relationship; source-row hash alone is retained, not the value |
| `ai_messages.created_at` | ai_messages.data.created |
| `ai_messages.updated_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `ai_runs.id` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.user_id` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.conversation_id` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.input_message_id` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.output_message_id` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.status` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.revision` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.model_placeholder` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.provider_model` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.reasoning_effort` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.reserved_credit_micros` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.charged_credit_micros` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.input_tokens` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.cached_input_tokens` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.output_tokens` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.cancel_requested` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.error` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.created_at` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_runs.updated_at` | not migrated because in-flight provider/tool executions cannot be replayed safely; message partials and zero reservation settlement are preserved |
| `ai_run_attempts.id` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_run_attempts.run_id` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_run_attempts.attempt` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_run_attempts.provider_model` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_run_attempts.provider_request_id` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_run_attempts.status` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_run_attempts.visible_output` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_run_attempts.input_tokens` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_run_attempts.cached_input_tokens` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_run_attempts.output_tokens` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_run_attempts.error` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_run_attempts.created_at` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_run_attempts.updated_at` | not migrated because provider request attempts cannot be resumed or replayed |
| `ai_conversation_tags.conversation_id` | not migrated because derived tag/search indexing uses the new AI lifecycle |
| `ai_conversation_tags.normalized_tag` | not migrated because derived tag/search indexing uses the new AI lifecycle |
| `ai_conversation_tags.display_tag` | not migrated because derived tag/search indexing uses the new AI lifecycle |
| `ai_conversation_tags.prompt_version` | not migrated because derived tag/search indexing uses the new AI lifecycle |
| `ai_conversation_tags.created_at` | not migrated because derived tag/search indexing uses the new AI lifecycle |
| `ai_context_snapshots.id` | not migrated because derived model context summaries are rebuilt from migrated messages |
| `ai_context_snapshots.conversation_id` | not migrated because derived model context summaries are rebuilt from migrated messages |
| `ai_context_snapshots.through_message_id` | not migrated because derived model context summaries are rebuilt from migrated messages |
| `ai_context_snapshots.summary_json` | not migrated because derived model context summaries are rebuilt from migrated messages |
| `ai_context_snapshots.prompt_version` | not migrated because derived model context summaries are rebuilt from migrated messages |
| `ai_context_snapshots.created_at` | not migrated because derived model context summaries are rebuilt from migrated messages |
| `ai_credit_accounts.user_id` | ai_accounts.user |
| `ai_credit_accounts.top_up_credit_micros` | ai_accounts.topup exactly |
| `ai_credit_accounts.reserved_credit_micros` | zero hold; zero-amount release ledger note carries legacy amount |
| `ai_credit_accounts.updated_at` | migration release ledger created timestamp when needed |
| `ai_credit_ledger.id` | ai_ledger.id |
| `ai_credit_ledger.user_id` | ai_ledger.user |
| `ai_credit_ledger.kind` | ai_ledger.kind |
| `ai_credit_ledger.delta_credit_micros` | ai_ledger.amount exactly |
| `ai_credit_ledger.top_up_after_credit_micros` | not migrated because target ledger stores delta, while current account balance is preserved exactly |
| `ai_credit_ledger.run_id` | not migrated because target entity omits this legacy metadata/relationship; source-row hash alone is retained, not the value |
| `ai_credit_ledger.admin_id` | not migrated because target entity omits this legacy metadata/relationship; source-row hash alone is retained, not the value |
| `ai_credit_ledger.idempotency_key` | ai_ledger.fingerprint |
| `ai_credit_ledger.note` | ai_ledger.note |
| `ai_credit_ledger.created_at` | ai_ledger.created |
| `ai_billing_policy.id` | not migrated because target plan policy is configured separately; existing top-up balances and plan ends are preserved |
| `ai_billing_policy.daily_credit_micros` | not migrated because target plan policy is configured separately; existing top-up balances and plan ends are preserved |
| `ai_billing_policy.weekly_credit_micros` | not migrated because target plan policy is configured separately; existing top-up balances and plan ends are preserved |
| `ai_billing_policy.default_plan_duration_days` | not migrated because target plan policy is configured separately; existing top-up balances and plan ends are preserved |
| `ai_billing_policy.updated_by` | not migrated because target plan policy is configured separately; existing top-up balances and plan ends are preserved |
| `ai_billing_policy.updated_at` | not migrated because target plan policy is configured separately; existing top-up balances and plan ends are preserved |
| `ai_plan_enrollments.user_id` | ai_accounts.user |
| `ai_plan_enrollments.starts_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `ai_plan_enrollments.ends_at` | ai_accounts.plan_ends |
| `ai_plan_enrollments.assigned_by` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `ai_plan_enrollments.updated_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `ai_credit_reservations.operation_id` | release ledger note/fingerprint for active reservations |
| `ai_credit_reservations.user_id` | release ledger user |
| `ai_credit_reservations.run_id` | not migrated because target entity omits this legacy metadata/relationship; source-row hash alone is retained, not the value |
| `ai_credit_reservations.amount_credit_micros` | release note amount; target ledger delta zero |
| `ai_credit_reservations.status` | active→zero release note; terminal rows not migrated because historical holds are already closed |
| `ai_credit_reservations.created_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `ai_credit_reservations.updated_at` | release ledger created |
| `ai_credit_usage.id` | not migrated because historical day/week allocation has a different target ledger model |
| `ai_credit_usage.operation_id` | not migrated because historical day/week allocation has a different target ledger model |
| `ai_credit_usage.user_id` | not migrated because historical day/week allocation has a different target ledger model |
| `ai_credit_usage.run_id` | not migrated because historical day/week allocation has a different target ledger model |
| `ai_credit_usage.day_key` | not migrated because historical day/week allocation has a different target ledger model |
| `ai_credit_usage.week_key` | not migrated because historical day/week allocation has a different target ledger model |
| `ai_credit_usage.charged_credit_micros` | not migrated because historical day/week allocation has a different target ledger model |
| `ai_credit_usage.plan_credit_micros` | not migrated because historical day/week allocation has a different target ledger model |
| `ai_credit_usage.top_up_credit_micros` | not migrated because historical day/week allocation has a different target ledger model |
| `ai_credit_usage.created_at` | not migrated because historical day/week allocation has a different target ledger model |
| `ai_file_operations.id` | not migrated because tool execution journals cannot safely resume across implementations |
| `ai_file_operations.user_id` | not migrated because tool execution journals cannot safely resume across implementations |
| `ai_file_operations.run_id` | not migrated because tool execution journals cannot safely resume across implementations |
| `ai_file_operations.call_id` | not migrated because tool execution journals cannot safely resume across implementations |
| `ai_file_operations.before_revision` | not migrated because tool execution journals cannot safely resume across implementations |
| `ai_file_operations.after_revision` | not migrated because tool execution journals cannot safely resume across implementations |
| `ai_file_operations.status` | not migrated because tool execution journals cannot safely resume across implementations |
| `ai_file_operations.result_json` | not migrated because tool execution journals cannot safely resume across implementations |
| `ai_file_operations.error` | not migrated because tool execution journals cannot safely resume across implementations |
| `ai_file_operations.created_at` | not migrated because tool execution journals cannot safely resume across implementations |
| `ai_file_operations.updated_at` | not migrated because tool execution journals cannot safely resume across implementations |
| `ai_workspaces.user_id` | ai_files.user / migration_workspace_rows.user_id |
| `ai_workspaces.blob_id` | retained ZIP object + validated file objects and ai_files |
| `ai_workspaces.staging_blob_id` | not migrated because unpublished staging transactions cannot resume |
| `ai_workspaces.updated_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `media_tracks.id` | media_tracks.id |
| `media_tracks.source` | media_tracks.source |
| `media_tracks.provider_id` | media_tracks.provider_id |
| `media_tracks.canonical_url` | not migrated because target resolves source/providerId |
| `media_tracks.title` | media_tracks.body.title (200-character cap) |
| `media_tracks.artists_json` | media_tracks.body.artists (20-artist limit) |
| `media_tracks.album` | media_tracks.body.album |
| `media_tracks.duration_ms` | media_tracks.body.durationMs |
| `media_tracks.thumbnail_url` | not migrated because target track has no thumbnail URL field |
| `media_tracks.metadata_revision` | not migrated because target global revisions are regenerated |
| `media_tracks.ref_count` | not migrated because object references are rebuilt |
| `media_tracks.last_used_at` | media_tracks.last_played |
| `media_tracks.created_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `media_tracks.updated_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `media_assets.track_id` | media_tracks.id / ledger ownership |
| `media_assets.kind` | audio attaches track.audio; cover retained as media.cover object reference |
| `media_assets.state` | ready bytes imported; unready/failed assets reported for re-preparation |
| `media_assets.blob_id` | objects.id after streaming |
| `media_assets.mime` | track.audio.mime (cover bytes retained without display metadata) |
| `media_assets.bytes` | verified objects.size / track.audio.size |
| `media_assets.failed_code` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `media_assets.downloaded_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `media_assets.updated_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `media_lists.id` | media_playlists.id; queue ID maps through user_queues |
| `media_lists.kind` | playlist→media_playlists; queue→media_user_states.queue |
| `media_lists.title` | playlist title (80-character cap); queue title omitted because queue is personal state |
| `media_lists.revision` | not migrated because target global revisions are regenerated |
| `media_lists.retention_days` | discarded; offline retention is now per user |
| `media_lists.expires_at` | discarded; no personal usage time is inferred from shared expiry |
| `media_lists.created_at` | media_playlists.created |
| `media_lists.updated_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `media_list_items.list_id` | playlist/queue membership |
| `media_list_items.position` | playlist.tracks / state.queue order |
| `media_list_items.track_id` | mapped track ID |
| `media_list_items.added_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `media_stream_grants.token` | not migrated because expiring bearer stream tickets must be reissued |
| `media_stream_grants.track_id` | not migrated because expiring bearer stream tickets must be reissued |
| `media_stream_grants.user_id` | not migrated because expiring bearer stream tickets must be reissued |
| `media_stream_grants.expires_at` | not migrated because expiring bearer stream tickets must be reissued |
| `media_stream_grants.created_at` | not migrated because expiring bearer stream tickets must be reissued |
| `user_queues.user_id` | media_user_states.user_id |
| `user_queues.list_id` | ordered list items become state.queue |
| `storage_quota_pools.name` | not migrated because target objects ledger and retention policy replace legacy cache weighting |
| `storage_quota_pools.max_weight` | not migrated because target objects ledger and retention policy replace legacy cache weighting |
| `storage_quota_pools.target_ratio` | not migrated because target objects ledger and retention policy replace legacy cache weighting |
| `storage_quota_pools.half_life_ms` | not migrated because target objects ledger and retention policy replace legacy cache weighting |
| `storage_quota_pools.updated_at` | not migrated because target objects ledger and retention policy replace legacy cache weighting |
| `storage_quota_items.pool` | not migrated because target objects ledger and retention references are rebuilt |
| `storage_quota_items.item_id` | not migrated because target objects ledger and retention references are rebuilt |
| `storage_quota_items.class` | not migrated because target objects ledger and retention references are rebuilt |
| `storage_quota_items.weight` | not migrated because target objects ledger and retention references are rebuilt |
| `storage_quota_items.heat` | not migrated because target objects ledger and retention references are rebuilt |
| `storage_quota_items.touched_at_ms` | not migrated because target objects ledger and retention references are rebuilt |
| `storage_quota_items.pin_until_ms` | not migrated because target objects ledger and retention references are rebuilt |
| `storage_quota_items.created_at_ms` | not migrated because target objects ledger and retention references are rebuilt |
| `post_images.id` | migration_images.legacy_id |
| `post_images.post_id` | chat_posts.data.image |
| `post_images.blob_id` | objects/object_refs original and regenerated thumbnail |
| `post_images.mime` | decoded target image MIME |
| `post_images.bytes` | verified original objects.size |
| `post_images.width` | decoded image width |
| `post_images.height` | decoded image height |
| `post_images.created_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `post_image_thumbs.image_id` | not migrated because JPEG thumbnails are regenerated from verified original images |
| `post_image_thumbs.blob_id` | not migrated because JPEG thumbnails are regenerated from verified original images |
| `post_image_thumbs.mime` | not migrated because JPEG thumbnails are regenerated from verified original images |
| `post_image_thumbs.bytes` | not migrated because JPEG thumbnails are regenerated from verified original images |
| `post_image_thumbs.width` | not migrated because JPEG thumbnails are regenerated from verified original images |
| `post_image_thumbs.height` | not migrated because JPEG thumbnails are regenerated from verified original images |
| `post_image_thumbs.state` | not migrated because JPEG thumbnails are regenerated from verified original images |
| `post_image_thumbs.generation` | not migrated because JPEG thumbnails are regenerated from verified original images |
| `post_image_thumbs.updated_at` | not migrated because JPEG thumbnails are regenerated from verified original images |
| `article_uploads.id` | not migrated because unpublished/abandoned uploads are incomplete transactions; published articles migrate from articles |
| `article_uploads.user_id` | not migrated because unpublished/abandoned uploads are incomplete transactions; published articles migrate from articles |
| `article_uploads.booklist_id` | not migrated because unpublished/abandoned uploads are incomplete transactions; published articles migrate from articles |
| `article_uploads.status` | not migrated because unpublished/abandoned uploads are incomplete transactions; published articles migrate from articles |
| `article_uploads.source_blob_id` | not migrated because unpublished/abandoned uploads are incomplete transactions; published articles migrate from articles |
| `article_uploads.archive_blob_id` | not migrated because unpublished/abandoned uploads are incomplete transactions; published articles migrate from articles |
| `article_uploads.source_bytes` | not migrated because unpublished/abandoned uploads are incomplete transactions; published articles migrate from articles |
| `article_uploads.archive_bytes` | not migrated because unpublished/abandoned uploads are incomplete transactions; published articles migrate from articles |
| `article_uploads.created_at` | not migrated because unpublished/abandoned uploads are incomplete transactions; published articles migrate from articles |
| `article_uploads.updated_at` | not migrated because unpublished/abandoned uploads are incomplete transactions; published articles migrate from articles |
| `booklists.id` | library_collections.id |
| `booklists.title` | library_collections.body.title (200-character cap) |
| `booklists.revision` | not migrated because target global revisions are regenerated |
| `booklists.created_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `booklists.updated_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `booklist_items.booklist_id` | library_items.collection |
| `booklist_items.position` | legacy position order determines collection body order; exact numeric position is not stored |
| `booklist_items.article_id` | library_items.id + collection docs |
| `booklist_items.added_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `group_booklists.group_id` | library_collections.body.group |
| `group_booklists.booklist_id` | library_collections.id |
| `access_bindings.resource_kind` | booklist/playlist select library/media collection; direct article/track grants excluded |
| `access_bindings.resource_id` | authority_grants.resource coll:<id> |
| `access_bindings.principal_kind` | authority_grants.principal_type |
| `access_bindings.principal_id` | authority_grants.principal + user/group projections |
| `access_bindings.grants_json` | authority_grants.level + module delegation; mixed delegation loss described above |
| `access_bindings.created_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `access_bindings.updated_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `access_effective.user_id` | not migrated because derived authority projections are regenerated from access_bindings and membership |
| `access_effective.resource_kind` | not migrated because derived authority projections are regenerated from access_bindings and membership |
| `access_effective.resource_id` | not migrated because derived authority projections are regenerated from access_bindings and membership |
| `access_effective.can_read` | not migrated because derived authority projections are regenerated from access_bindings and membership |
| `access_effective.can_write` | not migrated because derived authority projections are regenerated from access_bindings and membership |
| `access_effective.can_own` | not migrated because derived authority projections are regenerated from access_bindings and membership |
| `access_effective.can_share_read` | not migrated because derived authority projections are regenerated from access_bindings and membership |
| `access_effective.can_share_write` | not migrated because derived authority projections are regenerated from access_bindings and membership |
| `access_effective.can_share_own` | not migrated because derived authority projections are regenerated from access_bindings and membership |
| `access_effective.provenance_json` | not migrated because derived authority projections are regenerated from access_bindings and membership |
| `access_effective.updated_at` | not migrated because derived authority projections are regenerated from access_bindings and membership |
| `resource_possession.user_id` | not migrated because the design removes bearer tokens; current collection authority replaces possession recovery |
| `resource_possession.resource_kind` | not migrated because the design removes bearer tokens; current collection authority replaces possession recovery |
| `resource_possession.resource_id` | not migrated because the design removes bearer tokens; current collection authority replaces possession recovery |
| `resource_possession.capability` | not migrated because the design removes bearer tokens; current collection authority replaces possession recovery |
| `resource_possession.source_kind` | not migrated because the design removes bearer tokens; current collection authority replaces possession recovery |
| `resource_possession.source_id` | not migrated because the design removes bearer tokens; current collection authority replaces possession recovery |
| `resource_possession.expires_at_ms` | not migrated because the design removes bearer tokens; current collection authority replaces possession recovery |
| `resource_possession.updated_at` | not migrated because the design removes bearer tokens; current collection authority replaces possession recovery |
| `user_favorites.user_id` | library_states.user_id / media_user_states.user_id |
| `user_favorites.resource_kind` | article/track select module state; other kinds reported because no target state exists |
| `user_favorites.resource_id` | document/track ID |
| `user_favorites.favorited` | favourite/favorites LWW boolean |
| `user_favorites.updated_at_ms` | LWW stamp |
| `user_favorites.created_at` | not migrated because target imported entity has no equivalent historical field; semantic times explicitly listed above are preserved |
| `user_recents.user_id` | not migrated because recent-activity cache ranking is rebuilt in the target |
| `user_recents.resource_kind` | not migrated because recent-activity cache ranking is rebuilt in the target |
| `user_recents.resource_id` | not migrated because recent-activity cache ranking is rebuilt in the target |
| `user_recents.last_used_at` | not migrated because recent-activity cache ranking is rebuilt in the target |
| `user_recents.last_used_at_ms` | not migrated because recent-activity cache ranking is rebuilt in the target |

## Test fixtures on small temporary filesystems

For validation on hosts with a small shared temporary filesystem, `TALOS_LARGE_TEST_TMPDIR` and `TALOS_PACKAGE_E2E_TMPDIR` select existing disk-backed directories for the large synthetic backup and packaged-update fixtures respectively. Ordinary tests keep their normal temporary directory. These settings affect test fixtures only.
