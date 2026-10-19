# AGENTS.md — start here

Talos II (`talos-ng`) is a greenfield rewrite of `/home/flysoft/projects/classapp-next`
(read-only reference): a local-first school community app for managed tablets with a
self-hosted Node server (chat, library/reader, learning, media, AI, admin, netbooks).
Work is done by an orchestrator session that dispatches Codex jobs; the owner is not
available for questions — decide, and record notable decisions.

## Reading order

1. `docs/tasks/CHARTER.md` — mission, hard constraints, roles, model rules, and the owner
   feedback of session 4 at the bottom (it supersedes earlier text).
2. `docs/tasks/HANDOFF.md` — current state, what is verified, what is next.
3. `docs/tasks/ROADMAP.md` — milestone table (only if planning work).

## Hard constraints (never negotiable)

- Client runs on **Chrome 70+** (ES2018, no flex `gap`, no `inset`, no `aspect-ratio`, no
  ResizeObserver-only paths); offline through a **ServiceWorker**.
- Client storage is **IndexedDB only, never Blob values**.
- Deploy targets: **win32-x64**, **linux-debian-x64**, **linux-redhat-x64**; server and tools
  must work on Windows and Linux.

## Where documents live (never mix the kinds)

- `docs/tasks/` — ongoing process only: charter, handoff, roadmap, `DECISIONS.md` (living
  decision log), `COMPLETENESS.md` (living feature status), `LEGACY-SURVEY.md`, the
  `_common.md` Codex prompt preamble and the prompts/results of tasks still in progress.
- `archive/` (git-ignored, on disk only) — finished process material: completed task
  prompts and results, audits, reviews, rehearsal and measurement history. When a task
  finishes, carry any still-open finding into HANDOFF.md or the matching docs page, then
  `git rm --cached` the file and `mv` it to `archive/tasks/`. Nothing tracked links into it.
- `docs/product/README.md` (index) — product design: features, rules, UX; timeless, no task ids or file paths.
- `docs/impl/` — implementation design: architecture, mechanisms, structure rationale,
  `ops-*.md` how-tos (migrate, performance). Not a code mirror, no history.
- `README.md` is for humans; package READMEs only say what code and `docs/impl` do not.

## Workflow

- One task = one prompt file `docs/tasks/<id>-<name>.md` (in git) + one git worktree
  `../talos-ng-wt/<name>` on branch `m/<name>`. Codex prompt = `docs/tasks/_common.md` + task
  file on stdin of `codex exec`. Results/plans/audits live next to the prompt. The
  orchestrator merges, pushes `main` to `origin` (GitHub), monitors that exact commit's CI,
  and prunes the worktree. Helpers never merge or push, and commit after every step.
- Verification defaults to **push, then inspect CI** (owner instruction, 2026-10-16).
  CI on every commit runs, in parallel, typecheck+lint, all unit tests (one worker per core)
  and the e2e suites on current Chromium and real Chromium 70 and 80; it builds no packages
  (a manual `build`/`release` run does, D-145). Fix failures and push again
  until the relevant jobs pass; do not call an in-progress run successful.
  Do not require local full `pnpm check`, E2E suites or packaging before pushing.
  Use local checks only when a quick reproduction or targeted verification is useful,
  for example `node tools/e2e/run.mjs <feature> [--legacy]`. Preserve regression tests;
  this changes where full verification runs, not the quality requirements.
- Gate runs leave the tree clean: screenshots and measurements are ignored artifacts under
  `.tmp/e2e` (`packages/client/screenshots/` is ignored too). Never commit generated
  binaries (screenshots, packages, build output); there is no tracked reference screenshot
  set. Never use fixed ports or kill processes you did not start.
- `/tmp` is a small tmpfs on this host: point `TMPDIR`, `TALOS_LARGE_TEST_TMPDIR` and
  `TALOS_PACKAGE_E2E_TMPDIR` at a disk directory (e.g. `$PWD/.tmp`) for gates.
- Codex rules (details in the charter): every job gets a wall-clock `timeout`; a log that stops
  growing for ~20 min means kill and re-dispatch narrower; model/effort per the charter (never
  `gpt-6-sol` or `gpt-5.6-*`); check the quota meter with `node tools/codex-quota.mjs`
  (no arguments) before and after batches; no Claude sub-agents in parallel.
- Waiting on a long job (sub-agent or tool known to run for a long time): arm a one-shot
  self check-in about 55 min out (e.g. `send_later`) racing the job, so the orchestrator's
  prompt cache is bumped before it expires; re-arm while the job runs and cancel the
  check-in as soon as the job finishes first. Not for short jobs.
- Decisions are appended to `docs/tasks/DECISIONS.md` (next free D-number, assigned at merge);
  helpers do not edit `HANDOFF.md`/`ROADMAP.md` (the orchestrator owns them).
- Be sceptical: a claim counts only with evidence (command, test, screenshot); state what was
  not verified.

## Code organisation (owner rule)

Group by what depends on and changes with what, never by resemblance: no shared
`utils`/`helpers`/`common`, no catch-all `services`/`types`, no module hosting unrelated
features. Split logic finely; directories signal isolation and `tools/boundaries.mjs`
enforces it. Client UI logic stays separable from presentation (the UI will be redesigned).
Layout and rationale: `docs/impl/structure.md`.

## Tests (owner rule)

Keep only gates, thorough tests of complex logic, and per-feature end-to-end tests
(front-end e2e for complex features, API availability tests for simple ones). No trivial,
tautological, mock-echo, markup-snapshot or duplicate tests; prefer semantic e2e selectors
(`docs/impl/e2e-hooks.md`). Every bug fix commits its regression test (owner, 2026-10-19);
never keep one only locally.
