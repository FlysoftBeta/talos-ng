# Repository structure and the rules that keep it

Directories, not files: each directory exists to express one isolation rule, and
`tools/boundaries` fails the build when the rule is broken.

## 1. Packages and the dependency graph

`tools/boundaries/graph.mjs` is the one normative package graph (values or type-only):

- `base` imports nothing. `link`, `sync`, `docpack`, `objectstore`, `launcher`, `virtual`: `base` only.
- `contract`: `base`, `docpack` (types). `docpipe`: `base`, `docpack`, `objectstore` (types).
- `store`: `base` (browser, IndexedDB only, never Blob values). `shell`: nothing.
- `server`: all of the above except `store`/`shell`/`virtual`/`client`. `client`: `base`, `link`, `sync`,
  `docpack`, `contract`, `store`, `shell`, `virtual`.
- Policy lives only in `server` and `client`; they alone may depend on `contract`.
- Environments are checked too: browser/isomorphic packages may not import Node built-ins.
- Cross-package imports go through the published entry (`@talos/<pkg>`) or a named subpath
  (`@talos/virtual/dom`, `@talos/link/ws-node`, `@talos/objectstore/testing`).

The `virtual` package isolates its DOM-free core and source adapters from the DOM driver;
the core imports neither source adapters nor DOM code (`virtual-scroller.md`).

Small mechanism packages are split by what they own, not by technical layer:
`base` (async), `objectstore` (content, filesystem, lifecycle, memory, testing),
`docpipe` (conversion, file-spool, pdfrender, text, testing), `store` (database, files, kv,
testing), `launcher` (filesystem, logging, process, release), `contract` (protocol, policy,
`modules/*` domain contracts, admin and me split out). A directory may not reach into a
sibling's internals; shared types live in the owner's `ports`/`types` file.

## 2. Server (`packages/server/src`)

```
app/       composition root: builds the kernel and modules, registers the API, cross-module
           workflows (user purge, object access, dev seed). Only place that sees everything.
kernel/    mechanisms with no domain knowledge: config, diagnostics (audit/incidents/log),
           jobs, objects (ledger, uploads, tickets), persistence (Db, Uow, op results),
           sync (SyncHub), transport (link host, HTTP gateway).
modules/   one directory per domain: identity, authority, community, chat, library, media,
           netbooks, ai, tasks, me, admin, ops; `learning` keeps only the
           migration that drops the retired feature's tables.
```

Rules (`tools/boundaries/policy/server.mjs`):

- `server-kernel-independent`: kernel never imports `modules/` or `app/`. Kernel is reusable
  and testable without any domain.
- Modules meet only through a peer's `index.ts` or `ports.ts` (type imports included). A module
  that needs another module's data asks its port; it does not reach into its repo.
- Inside a module: `schema` (ordered migrations), `repo` (all SQL for its tables), `service`
  (rules, transactions, sync changes), `api` (contract binding, authorisation). Larger modules
  group by sub-domain (e.g. chat `posts/`, `drafts/`, `moderation/`), each with its own repo.
- Cross-module purge and object-access are composed in `app/` from per-module participants;
  user purge runs as one synchronous outer unit of work with identity removed last.

## 3. SQL ownership

Every table has exactly one owner directory, declared in `tools/boundaries/sql-owners.mjs`:
each module owns its `<module>_*` tables (identity owns `users`, `user_pins`, `sessions`,
`devices`, `invitations`, ...; authority owns grants; admin owns settings/announcements; ops
owns backups/downloads/office/settings), and the kernel families own `jobs`, `objects`,
`object_refs`, `uploads`, `audit`, `incidents`, the migrations table and the revision counter.

`tools/boundaries/sql-ownership.mjs` finds SQL in string and template literals through the
TypeScript AST and reads it with a bounded tokenizer (SELECT/INSERT/UPDATE/DELETE/WITH/DDL,
joins, sub-queries, CTEs, quoting, schema prefixes). A reference to a table owned by someone
else, an interpolated table position or unreadable SQL is a violation, never silently
accepted. Not covered: SQL assembled across functions at run time; the gate does not claim to
police arbitrary JavaScript.

Named allowances, all in `sql-owners.mjs` and all justified there:

- `dynamicTableGateways`: files that name tables dynamically. **Empty.**
- Backup: `ops/backup/snapshot.ts` opens a captured snapshot read-only. Its object inventory
  goes through the objects owner (`kernel/objects/inventory.ts`), so the backup code names no
  foreign table; integrity checks use PRAGMAs, which are not table references.

`tools/boundaries/exceptions.json` is the ratchet list of transitional violations. It is
**empty**; `node tools/boundaries/ratchet.mjs --check` (part of `pnpm lint`) fails on any
new entry and on stale ones, so the list can only shrink and nothing may be re-added silently.

## 4. Client (`packages/client/src`)

```
app/       composition root: runtime construction, area registry, frame, interaction guard.
core/      framework-free runtime: auth, data (repositories, commands, sync engine), files,
           lifecycle (boot/updates), navigation, status; controller-state.ts (StateStore).
platform/  adapters to the outside: browser, storage (IndexedDB via @talos/store), transport
           (link), react (context hooks and the one useController binding).
features/  one directory per product feature; see below.
ui/        presentational design system: theme, layout, inputs, overlays, data-grid, ...
dev/       development galleries; imported only by dev itself.
```

Rules (`tools/boundaries/policy/client.mjs`, plus shared `policy/product.mjs`):

- `client-core-independent`: core imports no app/features/ui/platform/react.
- `client-ui-independent`, `client-ui-no-contract-values`: ui is props-in, callbacks-out; no
  core, features, app, platform; `@talos/contract` types only.
- `client-platform-below-features`, `client-features-below-app`: dependencies point down;
  nothing below `app/` imports `app/`.
- `client-dev-isolated`: only `src/dev` imports `src/dev`.
- Features meet through a peer's `index.ts`; a model may also import a peer's TSX-free
  `model.ts` (this is how settings reuses auth's handle and PIN rules without React).
  `client-library-no-reader` / `client-netbooks-isolated` keep the library-reader and
  netbooks-library edges acyclic; `app/areas.tsx` supplies the reader slot.

### The model / connect / view / adapters contract

Each feature separates what changes with the product from what changes with the design:

- `model/` (or `model.ts`): state, controllers, selectors, formatting, command sequencing.
  No React, MUI, CSS, tsx, ui, platform or app imports, and no `ClientRuntime`; a controller
  receives a narrow injected port (`Pick<RuntimeSessionPort, ...>`) and extends `StateStore`.
  Rule `client-model-pure`. Models are plain-TypeScript tested with fake ports.
- `connect/` (or `connect.tsx`): the thin React binding. It creates controllers
  (`useController`), reads repositories through hooks and passes state and callbacks down.
  Rule `client-connect-binds-only`: no direct `@talos/store`, `@talos/link`, `@talos/shell`,
  storage or transport; those stay behind ports.
- `view/` (or `view.tsx`): presentational components receiving state and callbacks. Rules
  `client-view-no-runtime` (core is type-only, no platform/app) and
  `client-view-no-contract-values` (contract is type-only).
- `adapters/`: browser-specific helpers a feature needs (reader frame, anchors, visibility).

**Replace list.** Because views depend only on props and types, a redesign replaces the
`view/` files (and CSS) of a feature without touching models, connect logic or tests of
behaviour; the connect layer is the only seam to re-wire. Small features (settings, activity,
sharing) use `model.ts` + `connect.tsx` + `view.tsx` files instead of directories; the same
globs cover both spellings.

## 5. Tools

`tools/*` are covered by the same engine (`boundaryFiles` in `coverage.mjs`). Each tool has a
workspace dependency map in `policy/<tool>.mjs`; tests may be granted more than production
(`"test"` permission). Relative imports out of a tool need a named `edges` entry with a
reason. Product code never imports tools or test-support (`product-no-tools`,
`product-no-test-support`).

## 6. How enforcement works

- `eslint.config.mjs` runs the `boundaries/imports` rule on `boundaryFiles`: package graph and
  environments (`graph.mjs`), layer rules (`layers.mjs`, globs in `glob.mjs`), peer-entry rules,
  named edges, static-string imports only for packages.
- `ratchet.mjs --check` re-collects every violation ignoring recorded exceptions and fails on
  a difference; `--write` regenerates the list.
- `sql-ownership.mjs` is the B4 gate described in section 3, run by the same ratchet.
- `tools/boundaries/*.test.mjs` pin each rule with allowed and denied snippets.

## 7. Known limits

- SQL assembled across functions at run time is not checked.
- `model.ts` entries are reachable by any file of a peer feature, not only by its models.
- Native Windows execution of the packaging and launcher paths is not covered by these gates.
