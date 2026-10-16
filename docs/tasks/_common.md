# Common rules for package tasks (read before your task file)

- You work in a **git worktree** of talos-ng on your own branch. Read `docs/tasks/CHARTER.md`
  (hard constraints + working rules), `docs/impl/` (implementation design; your task
  names the documents), `docs/tasks/DECISIONS.md`, `docs/impl/architecture.md` (how to add a package) and
  `packages/base/src` (primitives you must reuse instead of re-implementing).
- Touch **only** your package directory (and `vendor/` or `tools/` paths your task names).
  Do not edit root config, other packages or docs other than the `docs/impl/` document that describes your package. If a shared
  file truly must change (e.g. a missing entry in the boundary table, a root devDependency),
  make the smallest possible change and list it prominently in your final message.
  `pnpm-lock.yaml` changes are expected and fine.
- The owner is unavailable: never ask questions. Decide, and record notable choices in
  `docs/tasks/DECISIONS.md` and the design in the matching `docs/impl/` document.
- Quality bar: production code, not a prototype. Small files with one responsibility, explicit
  types on public API, no `any` in public signatures, errors as `AppError` with codes from
  `@talos/base`, no hidden global state, injectable clock/random/timers where time matters so
  tests are deterministic (no real sleeps > 50 ms in unit tests).
- Tests are part of the deliverable: behaviour, edge cases, failure paths. Prefer many small
  deterministic tests; add property-style/randomised tests where an invariant exists.
- Must work on **Windows and Linux** (paths via `node:path`, no shell-outs to POSIX tools, no
  reliance on file modes/symlinks, handle `EBUSY`/`EPERM`), and browser-side code must run on
  **Chrome 70** (see `docs/impl/chrome70-compat.md`; ES2018 lib; no Blob persisted anywhere).
- Default full verification runs in CI after the orchestrator pushes. Do not run a full
  local `pnpm check`, E2E suite or package build as a prerequisite. Run only useful quick,
  targeted checks for your change and report what was actually verified. Install missing
  dependencies only when needed. Add regression tests even when CI will execute them.
- Commit on your branch in meaningful commits. Never push. Do not merge to `main`.
- Final message (≤ 25 lines): public API summary, test count, deviations from the spec with
  reasons, shared files touched, anything the integrator must know.
