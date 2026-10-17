# Server

Package `@talos/server`: kernel (mechanisms without domain knowledge), domain modules and
the composition root. Layout, import rules and SQL ownership are in `structure.md`; this
document covers the runtime design. Entry points: `packages/server/src/main.ts`
(`startServer`), `app/create-application.ts` (`createKernel`), `kernel/*`, `modules/*/index.ts`.

## Process model

One Node process bundled into a single `server.js`. SQLite is `better-sqlite3` behind a
small `Db` adapter file (WAL, foreign keys, `synchronous=NORMAL`, busy timeout, one
synchronous writer on the main thread, savepoint-nested transactions, online backup). All
writes and transactions stay on that single writer. Sync pull pages, the dominant read, are
computed by **sync replicas**: worker threads that load the same `server.js`, open the
database read-only and build the module graph over that connection (`createKernel` with
`replica: true`: verify-only migrations, no start-up writes, no background work), so pages
come from exactly the providers and serialisers the writer registers. Each task runs in one
read transaction; the WAL makes every commit made before the task was sent visible to it
(read-your-writes for the caller's own preceding writes). Subscription and transfer state
stay on the main thread (`SyncHub.pullFrom`, see `sync.md`). A replica that fails, hangs past
its timeout or is not yet started makes the pull run locally; crashed replicas restart with
back-off. Replicas close before the writer's final WAL checkpoint. Development entries are
TypeScript, so a replica bootstraps the tsx loader before importing the entry. Child
processes exist only for helper binaries (pdfrender, yt-dlp). Two native N-API addons exist,
`better-sqlite3` (loaded by the main thread and by each replica worker) and `sharp` (chat thumbnails); they stay external to the bundle and each
release carries only its own platform's binaries in `node_modules/` (see `packaging.md`).
WebSocket uses pure-JS `ws`.

Dependencies are constructed once in `app/create-application.ts` and passed explicitly: no
globals, no `AsyncLocalStorage`. Tests build a kernel on `:memory:` + memory object store +
memory carrier with injected clock and timers.

`startServer(config)` resolves the data layout, opens the database, builds the kernel and
listens on every configured HTTP/HTTPS port; `close()` is idempotent: stop accepting, drain
link calls (at most ten seconds), abort workers, close carriers, checkpoint the WAL, close
SQLite. Maintenance (operation-result, ticket, staging, upload and object sweeps, media
eviction, backups) runs from one serialised `maintain` pass.

## Kernel services

`config` (file + `TALOS_*` environment, validated at boot, secrets never logged), `db`
(adapter, migrations, nestable synchronous `tx`, read `snapshot`, online `backupTo`), `uow`, `rev` (global
revision counter), `syncHub` (`sync.md`), `events` (connection registry, per-user/scope
fan-out), `jobs` (`jobs.md`), `objects` and `uploads` (`objects.md`), `authz`, `audit`,
`incidents`, `clock`, `log`, and the transport (`link.md`).

### Unit of work

`Uow.write(ctx => result)` owns the outer transaction and the revision. Nested writes use
savepoints and merge successful changes and effects. Inside, `ctx.changed(scope, type, id)`
marks rows for sync fan-out (deduplicated; a failed write publishes nothing) and
`ctx.afterCommit(fn)` schedules external effects after commit; a failing after-commit effect
is reported but never turns a committed write into a failure. Every module write is one
`Uow.write`.

### Data conventions

Ids are ULIDs (TEXT) except where a natural key exists; times are INTEGER epoch milliseconds
(no ISO strings in storage or on the wire); booleans INTEGER 0/1 with CHECK; JSON columns TEXT
with `json_valid` CHECK; every table `STRICT`. Every synced table carries `rev INTEGER NOT
NULL` (global revision at last change) and `deleted INTEGER NOT NULL DEFAULT 0` (tombstone)
and an index on `(scope key, rev)`. Migrations are forward-only and numbered per module,
recorded in `_migrations(module, n, applied_at)`; history must be contiguous, unknown applied
versions are refused, a migration never destroys user data, and pending migrations of a
module share one transaction. The ops module's migration namespace is `operations` because
the kernel's `ops` names RPC idempotency storage.

### Diagnostics

`Incidents.report` groups failures by fingerprint with bounded retention. Diagnostics capture
faults **without their payloads**: source, build, a bounded environment and redacted stack
frames, never exception messages or call arguments. The browser keeps at most 20 reports in
a user-scoped IndexedDB buffer, and the server accepts 30 reports per actor per minute.
`Audit.append` is SQL-enforced append-only. `Logger` writes leveled JSON lines to the console
and size-rotated files, redacting credential keys. The incident ZIP export contains the
current build's rotated server log records plus incidents and audit.

## Modules

`modules/<name>/{schema, repo, service, api, index}` (see `structure.md` for the rules):
`schema` = ordered migrations, `repo` = all SQL for the module's tables, `service` = domain
rules and transaction boundaries (stamps rows with the transaction revision, marks every
touched `(scope, type, id)`), `api` = binds contract methods and does authorisation (actor
policy lives here and nowhere else). Adding a module: contract file, schema + repo +
service + api, register scope providers and entity serialisers **before** serving
connections, register job kinds before the runner starts, test with memory SQLite and carriers.

| Module | Owns |
|---|---|
| identity | users, PINs, sessions, invitations/onboarding, devices (admission, whitelist, binding, throttle, lock); see `identity.md` |
| authority | admin roles, feature gates, resource grants |
| community | groups (hierarchy, discovery, passwords), memberships, DMs |
| chat | posts, images, stickers, conversation state, announcements |
| library | documents, collections, items, favourites, reading progress |
| netbooks | network-novel search/download provider (jobs into library) |
| learning | word corpus, progress, quizzes, discipline mode |
| media | tracks, playlists, queue, provider (yt-dlp), audio cache |
| ai | conversations, runs, billing/credits, workspace files, model config |
| tasks | user-visible projection of jobs |
| me | profile and settings projection |
| admin | workbench queries, bulk operations, audit/incident views, global settings |
| ops | backups, updates, HTTPS status, host tools, Office capture |

Per-module mechanisms: `modules.md`. Cross-module workflows (user purge, object access, dev
seed) are composed in `app/` from per-module participants and predicates.

## Configuration

One `talos.config.json` beside the data directory, overridden by `TALOS_*` variables; relative
paths resolve beside the config file. Data directory: `data/talos.db` (+WAL), `data/objects`,
`data/backups`, `data/updates`, `data/logs`.

| Variable | Format and default |
|---|---|
| `TALOS_PORTS`, `TALOS_SECURE_PORTS` | port, comma list or JSON array; default `[8080]` and `[]`; `0` allocates a free port for tests; secure ports need cert and key |
| `TALOS_BIND_HOST` | default `0.0.0.0` |
| `TALOS_DATA_DIR` | default `./.data` |
| `TALOS_ASSETS_DIR`, `TALOS_WORKER_FILE` | client release `dist` directory and service-worker file; defaults under `packages/` |
| `TALOS_BUILD` | safe identifier, default `dev`; the release manifest's build wins |
| `TALOS_DEV`, `TALOS_TEST_SEED` | booleans, default `false`; the seed requires dev mode |
| `TALOS_HTTPS_CERT/KEY/CA/DOMAIN/REDIRECT` | PEM paths, CA served at `/ca.crt`, domain required for redirect, redirect needs a secure port |
| `TALOS_AI_MODELS_FILE`, `TALOS_AI_CONFIG` | AI provider configuration (`modules.md`) |
| `TALOS_BINARIES` | JSON map of helper binary paths (`pdfrender`, `yt-dlp`) |
| `TALOS_DB_READERS` | sync replica workers, integer 0–32; default `min(4, cpus − 1)`; `0` computes every pull on the main thread |
| `TALOS_PDFRENDER`, `TALOS_MEDIA_CACHE` | renderer binary override; yt-dlp download cache at package time |

`pnpm dev` runs the real dev server plus Vite behind a same-origin proxy for `/link`, `/dl`,
`/app`, `/sw.js` and `/ca.crt`; no service worker is registered in development. `pnpm build`
then `pnpm start` serves the production client from the real server.

## Test seed

`dev: true, testSeed: true` (both required; config and kernel reject the switch outside dev
mode) atomically creates a root and an ordinary demo account in a completely empty database
only; existing databases are never modified. There is no production test endpoint and no
special auth contract. The seed also swaps in deterministic fake media, netbooks and AI
providers. Credentials are in the seed code (`app/dev-seed.ts`) and used by the e2e harness.
