# Talos II

A local-first school community application for managed Chrome 70+ tablets, with a
self-hosted Node server. Complete rewrite of the legacy `classapp-next` app. Start with
[`AGENTS.md`](AGENTS.md) (workflow) and [`docs/tasks/HANDOFF.md`](docs/tasks/HANDOFF.md) (current state).

- `packages/`: source-consumed `@talos/*` packages — `base`, `link` (own transport),
  `objectstore`, `docpack` + `docpipe` (document pipeline, pdfrender), `store` (IndexedDB),
  `sync`, `contract`, `server`, `shell` (ServiceWorker + installer), `client`, `launcher`.
- `tools/`: boundary lint, Chrome 70 compatibility check, e2e harness (current Chromium and
  real Chromium 70), packaging (`win32-x64`, `linux-debian-x64`, `linux-redhat-x64`),
  `migrate` (journaled legacy importer; see [the migration guide](docs/impl/ops-migrate.md)).
- `docs/`: [`product/`](docs/product/README.md) (what the product does), `impl/` (how it is built, plus operational
  guides), `tasks/` (process: charter, handoff, decisions, audits, task prompts and results).

Default verification: push the commit and inspect its CI `check` and three-platform
package jobs; repair failures and push again. Full local checks are not a pre-push
requirement. Use targeted local tests or browser scenarios when useful for quick feedback.
The UI is functional but slated for a from-scratch redesign (see
[`docs/tasks/HANDOFF.md`](docs/tasks/HANDOFF.md)).

Use Node **24.18+ (24.x)** and Corepack's pinned **pnpm 12.11.2**:

```text
pnpm install
```

CI runs `pnpm check`, which runs `typecheck`, `lint` (including `format:check`), `test`, and `build`.
`pnpm format` applies Prettier; `pnpm test:coverage` produces optional V8 coverage.
Library builds check types; source exports require no intermediate build artifacts.
TypeScript 7 runs checks; the TypeScript 6 API is retained solely for ESLint until
its parser supports the new compiler API.

```text
node tools/compat-check/cli.mjs tools/compat-check/fixtures/good
node tools/compat-check/cli.mjs path/to/assets --allowlist path/to/polyfills.json
```

See [`docs/impl/architecture.md`](docs/impl/architecture.md) ("Adding a package") before adding a package. Root
commands and test projects discover new packages without shared-file edits.

`pnpm package` produces `win32-x64`, `linux-debian-x64` and `linux-redhat-x64`
installs, update ZIPs and JSON manifests in `dist/release/`. Build one with
`pnpm package -- --target linux-redhat-x64`. Select the Linux distribution family
and install its required system libraries; updates must match the exact target.
Each artifact carries only its own platform's `better-sqlite3` and `sharp` binaries in
`node_modules/` (pinned by `tools/package/native-manifest.json`, see
[packaging](docs/impl/packaging.md)); `pnpm install` also fetches the win32 sharp package
so Windows releases can be assembled on Linux.
See [release assembly and operator instructions](tools/package/README.md).
