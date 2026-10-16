// B4 data: which code may reference which SQL table. Keyed by owner; edit the
// `paths` here when directories move (149b); tables never move.
// `paths` entries ending in "/" are directory prefixes, others exact files.
const server = "packages/server/src/";
const module = (name) => `${server}modules/${name}/`;
export const sqlOwners = {
  identity: {
    paths: [module("identity")],
    tables: [
      "users",
      "user_pins",
      "sessions",
      "devices",
      "invitations",
      "secrets",
      "identity_policy",
      "identity_ip_throttle",
    ],
  },
  authority: {
    paths: [module("authority")],
    tables: [
      "authority_access",
      "authority_grants",
      "authority_grant_projections",
    ],
  },
  community: {
    paths: [module("community")],
    tables: ["community_conversations", "community_members"],
  },
  chat: {
    paths: [module("chat")],
    tables: [
      "chat_posts",
      "chat_states",
      "chat_texts",
      "chat_ack",
      "chat_mutes",
      "chat_announcements",
      "chat_stickers",
    ],
  },
  library: {
    paths: [module("library")],
    tables: [
      "library_documents",
      "library_collections",
      "library_items",
      "library_states",
      "library_retentions",
      "library_delegations",
    ],
  },
  media: {
    paths: [module("media")],
    tables: [
      "media_tracks",
      "media_playlists",
      "media_user_states",
      "media_retentions",
      "media_delegations",
      // Present in the migrations but missing from the 147 owner table.
      "media_discoveries",
      "media_playlist_tracks",
    ],
  },
  ai: {
    paths: [module("ai")],
    tables: [
      "ai_accounts",
      "ai_files",
      "ai_ledger",
      "ai_messages",
      "ai_policy",
      "ai_rows",
      "ai_runs",
      "ai_texts",
      "ai_tools",
    ],
  },
  netbooks: {
    paths: [module("netbooks")],
    tables: ["netbooks_downloads", "netbooks_chapters"],
  },
  learning: {
    paths: [module("learning")],
    tables: ["learning_corpus", "learning_words", "learning_progress"],
  },
  me: { paths: [module("me")], tables: ["me_settings"] },
  admin: {
    paths: [module("admin")],
    tables: [
      "admin_settings",
      "admin_downloads",
      "admin_announcement_revisions",
    ],
  },
  ops: {
    paths: [module("ops")],
    tables: ["ops_backups", "ops_downloads", "ops_office", "ops_settings"],
  },
  // Kernel families. link-host owns the operation-replay reads of `ops`.
  "kernel-persistence": {
    paths: [
      `${server}kernel/transport/link-host.ts`,
      `${server}kernel/persistence/`,
    ],
    // `ops` is operation replay, unrelated to the ops module.
    tables: ["_migrations", "_revision", "op_result_key", "ops"],
  },
  "kernel-jobs": {
    paths: [`${server}kernel/jobs/`],
    tables: ["jobs"],
  },
  "kernel-objects": {
    paths: [`${server}kernel/objects/`],
    tables: ["objects", "object_refs", "uploads"],
  },
  "kernel-diagnostics": {
    paths: [`${server}kernel/diagnostics/`],
    tables: ["audit", "incidents"],
  },
};
// Files whose job is to name tables dynamically. Each entry needs a reason.
export const dynamicTableGateways = [];
// Offline SQL outside the server: allowed by directory, never ownership-scanned.
export const offlineSqlDirectories = [
  {
    path: "tools/migrate/",
    reason:
      "One-shot offline import: reads the legacy database and writes through server schemas.",
  },
];
export const scanRoot = "packages/server/src/";
