# Architecture

Talos II is a local-first school community application: a React client for managed Chrome 70+
tablets and one self-hosted Node.js + SQLite server, connected by an own transport. This
document is the map: premises, packages and their direction, runtime topology and tooling.
The mechanisms have their own documents (index: `README.md`); repository layout and the
rules that keep it are in `structure.md`.

## Premises

- **Chrome 70 floor** for syntax, CSS and Web APIs (`chrome70-compat.md`). Client storage is
  IndexedDB only, never Blob values (`client-store.md`). The app must start and stay useful
  with the server gone, offline through a ServiceWorker.
- **Local-first**: the UI renders from local state; the network only synchronises it
  (`sync.md`). All state of connection, sync, pending changes, downloads and storage is
  exposed to the UI.
- **One owner per concern**: mechanisms (packages) know nothing of policy (modules), policy
  lives only in `server` and `client`.
- **No native Node addons, no host prerequisites**: a release is a folder with a bundled Node
  runtime, one server bundle, static client assets and vendored helper binaries
  (`packaging.md`). Deploy targets: `win32-x64`, `linux-debian-x64`, `linux-redhat-x64`;
  server and tools work on Windows and Linux.
- **Dependencies are explicit**: constructed once and passed, no globals, no
  `AsyncLocalStorage`; ids are ULIDs, times integer epoch milliseconds, tables STRICT,
  migrations forward-only per module.
- **No Rust/WASM toolchain**: virtual list and resource decoding are pure TypeScript
  (`fflate` on the client, `node:zlib` on the server).

## Packages and direction

pnpm workspace, TypeScript everywhere, ESM sources consumed from `src` (libraries export
`src/index.ts`; a package gets a real build artifact only when it ships a bundle).

| Package | Role |
|---|---|
| `base` | isomorphic primitives: `AppError`/`Result` and error codes, `ulid`, `HybridClock`, bytes and `Sha256`, `Semaphore`, `Emitter`, exhaustive `Fsm`, `backoff`, `deferred`, `sleep` |
| `link` | own transport: frames, client FSM, server core, carriers (`link.md`) |
| `contract` | typed method / event / entity registry shared by server and client (`link.md`) |
| `sync` | pure sync algorithms: registers, intervals, pull planner, outbox reducer (`sync.md`) |
| `docpack` | isomorphic document pack format (`documents.md`) |
| `objectstore` | server: content-addressed object store (`objects.md`) |
| `docpipe` | server: document converters (`documents.md`) |
| `store` | browser: IndexedDB engine and chunked file store (`client-store.md`) |
| `shell` | ServiceWorker and asset installer, dependency-free (`packaging.md`) |
| `launcher` | process supervisor, update swap and rollback (`packaging.md`) |
| `server` | application server: kernel + modules (`server.md`, `modules.md`) |
| `client` | React application: core + platform + ui + features (`client-runtime.md`) |

The normative dependency graph is `tools/boundaries/graph.mjs`; in short, `base` imports
nothing, mechanism packages depend on `base` (plus type-only edges), `server` and `client`
are the only places where policy lives and the only packages allowed to depend on
`contract`, `client` never imports Node packages and `server` never imports browser packages.
`tools/` live under the same engine; `tools/migrate` reaches the server only through
`@talos/server/migration`. Rules and rationale: `structure.md`. Each package README is a
pointer to the document that describes it.

Mechanisms stay usable without the app (link, objectstore, docpack, docpipe, store, sync have
independent tests), which is why they are separate packages rather than folders.

## Runtime topology

```
tablet (Chrome 70+)                                   server host (one Node process)
 ServiceWorker (shell) -- assets from IndexedDB        launcher -- supervises --> server.js
 client runtime ---- one WebSocket /link ------------> LinkServer -> LinkHost -> modules
   repositories / outbox / file store (IndexedDB)             |          kernel: Db (SQLite WAL),
   <-- sync.delta events, pull on connect                      |          Uow, SyncHub, Jobs,
 <audio>/downloads -- GET /dl/<ticket> (range) ------> HTTP gateway   ObjectLedger + ObjectStore
 first visit / updates -- GET /, /sw.js, /app/* ----->              helper binaries (pdfrender, yt-dlp)
```

- One multiplexed connection carries RPC, uploads, downloads and live events; HTTP exists
  only as a static/bootstrap gateway and ticketed byte downloads (`link.md`).
- The server is a single process with a synchronous SQLite writer; asynchronous effects start
  after commit; heavy work is child processes or jobs (`server.md`, `jobs.md`).
- Data directory beside the installation: database, content-addressed objects, backups,
  update staging, logs. Releases are immutable directories switched by a pointer file
  (`packaging.md`).

## Tooling decisions

- Workspace tooling requires Node 24 (`^24.18.0`) and Node 24 declarations. Server,
  launcher and migration bundles target `node24`; release assembly and CI pin the
  official Node 24 runtime version documented in `packaging.md`.

- Source entrypoints with non-erasable TypeScript in their import graph (server,
  migration and release tools) use the workspace-pinned `tsx` loader via
  `node --import tsx`. The migration wrapper registers `tsx/esm/api` in-process before
  importing its main module; there is no bootstrap child process. Other Node scripts
  use Node 24 built-in type stripping where their imports contain only erasable syntax.
- TypeScript 7 checks the source (`tools/typecheck.mjs` selects the native compiler); the
  TypeScript 6 API is retained only because ESLint's parser does not yet support the 7 API.
  Prettier is part of `pnpm check` (lint includes `format:check`).
- Vitest for unit tests (each package manifest is a discovered project), Playwright for
  browser e2e on current Chromium, a raw-CDP harness for real Chromium 70 (`tools/e2e`,
  `tools/legacy-chromium`); kernel and module tests run on in-memory SQLite + memory object
  store + memory carrier, `@talos/store` tests on `fake-indexeddb` and in real Chromium.
- Isomorphic production typechecks exclude tests and ambient Node/DOM types; browser worker
  configs opt into ES2018+WebWorker separately. Pnpm installs are explicit
  (`verifyDepsBeforeRun: false`) so scripts never change lockfiles.
- Boundary lint (`tools/boundaries`) enforces the package graph, layering, module entries and
  SQL table ownership; its ratchet list is empty and can only shrink.
- Large validation fixtures can use disk scratch space: `TALOS_LARGE_TEST_TMPDIR` (backup
  test) and `TALOS_PACKAGE_E2E_TMPDIR` (packaged update test) select the directory for tests
  only. E2e output is ignored; `TALOS_E2E_UPDATE=1` alone refreshes tracked measurements.
- Product assets (sticker packs, word corpus, icons) are copied from the legacy project when
  a feature needs them, with the third-party provenance unchanged.
- `tools/package` and `tools/migrate` are operational tools (`packaging.md`, `ops-migrate.md`).

## Adding a package

Create only the package directory; shared configuration already knows the workspace layout.
Required: `package.json` (`@talos/<name>`, private, `type: module`,
`exports: {".": "./src/index.ts"}`, every imported workspace package declared as
`workspace:*`, scripts `typecheck`, `lint`, `test`, `build`), `tsconfig.json` extending the
`isomorphic`, `browser` or `node` preset in `tools/tsconfig/` (production includes
`src/**/*.ts`, excludes tests), `tsconfig.test.json`, `src/index.ts` with named public exports
and colocated `*.test.ts`. A package declares its edges in `tools/boundaries/graph.mjs`. No
Vitest config is needed for default Node tests; jsdom or browser mode adds a
`vitest.config.ts` exporting `defineProject` with a unique project name. Packages that ship a
bundle need a real `build`. Run `pnpm install` and `pnpm check`.
