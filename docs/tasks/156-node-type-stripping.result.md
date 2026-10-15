# 156 — Result

Implemented on Node v24.18.0. Removed the experimental transform option from runtime
scripts, subprocess arguments, developer commands and the native-manifest diagnostic.
Public application APIs and CLI arguments are unchanged.

## Approach

- Use the existing pinned `tsx` 4.23.15 through `node --import tsx` for source entrypoints
  whose transitive imports require transformation. Declare it explicitly at the root,
  server, migration and release-tool workspaces; the lockfile adds importer entries only.
- Keep plain Node execution and built-in stripping for existing scripts that support it.
  No equivalent experimental transform option was introduced.
- Replace migration's flag-dependent synchronous re-exec with `tsx/esm/api` registration
  before the dynamic main import. There is one process: existing Node arguments remain
  effective, application arguments still come from `process.argv.slice(2)`, signals reach
  the CLI directly, and the existing caught-error/exit-code-1 behavior remains. No spawn
  guard or signal/exit forwarding layer is needed.
- Document the loader choice in architecture and migration design. Avoid a broad syntax
  rewrite across server/domain code solely to change its development launcher.

## Evidence

- `pnpm install`: exit 0 before edits and again after explicit loader dependencies.
- Unmodified `pnpm build`: exit 0, bounded by `timeout 600`; disk-backed `TMPDIR`,
  `TALOS_LARGE_TEST_TMPDIR`, `TALOS_PACKAGE_E2E_TMPDIR`. Existing build typechecks and
  static Chrome 70 checks passed (0 compatibility violations). Log: ignored
  `.tmp/156-build.log`.
- Read-only Node `stripTypeScriptTypes({ mode: "strip" })` scan: 772 tracked `.ts`
  files excluding declarations; 178 rejected for parameter properties. No source executed.
  A literal runtime-import graph scan found strip-only rejections for every affected
  source entrypoint (local-module counts / rejected-module counts):

  | Entrypoint | Local modules | Rejected |
  | --- | ---: | ---: |
  | Server | 298 | 101 |
  | Seeded server | 299 | 102 |
  | Learning seed | 73 | 16 |
  | Development orchestrator | 17 | 3 |
  | Release assembly | 28 | 6 |
  | Native manifest tooling | 26 | 6 |
  | Packaged e2e harness | 74 | 9 |
  | Windows smoke harness | 26 | 6 |
  | Migration main | 327 | 101 |

  These graphs all reach parameter properties in `@talos/base`; the server and migration
  also reach many domain constructors. The scan follows literal imports/exports and
  literal dynamic imports, skips external dependency code, and is static evidence rather
  than exhaustive runtime qualification. Log: ignored `.tmp/156-syntax.log`.
- `node tools/migrate/bin/migrate.mjs --help`: loaded the complete main import graph,
  returned the existing usage diagnostic and exit 1 before opening any database.
- `node --import tsx tools/package/build.ts --help`: loaded its import graph and returned
  the existing usage error/exit 1 before release assembly, filesystem writes or downloads.
- Final tracked search leaves the removed option only in the task prompt and the protected
  historical D-111 command in `docs/tasks/DECISIONS.md:486`.

## Limitations and integration

No tests were added or run (0 executed). No check, e2e or package gate was run, as requested.
Live server startup, migration data processing, signal delivery, packaged artifacts and
native Windows execution were not exercised. Static review supports the single-process
signal/argument behavior; the help invocation establishes loading and error exit only.

Shared changes: root `package.json`, `pnpm-lock.yaml`, `docs/impl/architecture.md`,
`docs/impl/ops-migrate.md`; affected server, e2e, migration and release files are in scope.
No HANDOFF, ROADMAP, DECISIONS or task-154 edits. The orchestrator should correct D-111's
historical native re-pin command to `node --import tsx tools/package/native.ts --pin` if
updating that protected log. No spec deviation; the existing-loader fallback is required
by the transitive syntax. Commit only; no merge or push.
