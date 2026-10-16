# talos-ng — orchestration charter

Read this first, then `docs/tasks/HANDOFF.md` (current state, next steps). Both are the only
context carried between orchestrator sessions. Keep HANDOFF.md short and current.

## Mission

Complete greenfield rewrite of the app in `/home/flysoft/projects/classapp-next/` into this
repository (`/home/flysoft/projects/talos-ng`). Deliver a polished, tasteful, well-engineered,
**complete** product. The owner is not available: never ask questions, decide and record the
decision in `docs/tasks/DECISIONS.md`.

- IGNORE `/home/flysoft/projects/classapp-next/rewrite` (an abandoned rewrite plan). Also skip
  `node_modules`, `build`, `backups`, `worktree`.
- The legacy project is read-only reference. Never modify it.

## Hard constraints (the only things that must be kept)

1. Client runtime: **Chrome 70+**. Build target, syntax, CSS and Web APIs must all work there
   (no optional chaining un-transpiled, no `ResizeObserver`-only paths without fallback, no
   `BigInt`, no top-level await, no CSS `gap` for flexbox, no `inset`, no `aspect-ratio`, etc.).
2. Offline capability through a **ServiceWorker**.
3. Client storage in **IndexedDB only, never Blob values** (store ArrayBuffer / strings).
4. Deploy targets: **Windows amd64** (real deployment) and **Linux glibc amd64** (dev machine).

## Recommended direction (owner's preference)

- Node.js + TypeScript + SQLite + MUI. ("TypeScript (go)" = the native tsgo compiler is fine
  for type-checking where it works.)
- Reuse the existing server-side PDF rendering implementation (legacy `lib/poppler` & the
  PDFRender code); design the document pipeline so other formats (epub …) can be added later.
- Do NOT lean on tooling built for modern browsers / web-page browsing: own transport layer,
  no SSR, no Next.js or other frameworks tied to HTTP semantics, no pdf.js, no URL-based router.
- Re-engineer every module: sharp boundaries, easy to test and maintain (object storage is the
  canonical example of a module that deserves a clean standalone boundary).
- UX with a coherent overall design logic — users always know what they are doing and what
  state the system is in (offline/syncing/etc). Compact UI laid out for tablets; details matter.
- Do not be bound by legacy logic, code organisation or thinking. Data migration from the old
  system is considered only after the new product is largely complete (last milestone).

## Roles and budget

- **Top-level Claude**: only spawns orchestrator sessions sequentially and does final checks.
- **Orchestrator session (you, a Claude subagent)**: designs, writes specs/prompts, dispatches
  Codex, reviews results, integrates, keeps docs current. Do NOT do bulk reading or bulk coding
  yourself — your context is the scarce resource. Legacy exploration, implementation, test
  writing, debugging, browser verification are all Codex jobs. Read Codex's final summaries and
  spot-check; don't read whole diffs unless something smells wrong.
- Do not spawn parallel Claude subagents. If you need an isolated Claude helper use Sonnet,
  one at a time. Prefer Codex for everything context-heavy.
- **Codex** (`codex exec`, CLI 0.162.1) does the heavy work and may run in parallel.
  - Genuinely important or difficult tasks only: model `gpt-6-astra`,
    `-c model_reasoning_effort="high"`.
  - Everything else (owner rule, session 3): a lower reasoning level — `gpt-6.1-sol` at
    medium, or `gpt-6-astra` at medium. The id `gpt-6.1-sol` exists (verified via the
    app-server model list); **never use `gpt-6-sol` or `gpt-5.6-*`**, and pin the model
    explicitly for any Codex sub-agents too.
  - Typical call (run in background, capture last message to a file, don't stream output
    into your context):
    `codex exec -m gpt-6-astra -c model_reasoning_effort="high" -s workspace-write -c sandbox_workspace_write.network_access=true -C <dir> -o <scratch>/<task>.last.md - < <prompt file> > <scratch>/<task>.log 2>&1`
  - Parallel Codex tasks must not collide: use `git worktree`s / disjoint packages, merge after.
  - Budget: everything currently available plus ONE usage reset (≈ two weekly quotas). Use the
    usage reset only when the limit is actually exhausted, never earlier; record in HANDOFF.md
    that it has been used. Pace so the whole job finishes inside that budget.
- Prompts to Codex are files under `docs/tasks/` (kept in git): self-contained, with goal,
  constraints, interfaces/contracts, acceptance criteria and required verification commands.

## Working rules

- Git: work on `main`; commit early and often with meaningful messages. Remote `origin`
  (https://github.com/FlysoftBeta/talos-ng.git): push `main` to `origin` after each completed
  unit, then monitor the exact commit's CI and repair failures. Only the orchestrator pushes.
- Owner instruction (2026-10-16) supersedes earlier local-gate prerequisites: default to
  pushing and inspecting CI `check` and packaging results. Do not run full local checks,
  E2E suites or packaging as a mandatory pre-push step. Local verification is optional
  when useful for quick reproduction or targeted feedback; keep it scoped to the change.
- Every module ships with regression tests. CI must pass typecheck, lint, tests, build,
  Chrome 70 static compatibility checks and the package matrix. Use real browsers or PDF
  fixtures locally when needed to diagnose or quickly verify behaviour that unit tests
  cannot establish. Report the actual verification evidence and outstanding CI results.
- Windows amd64 must work: no POSIX-only assumptions, native deps need win32-x64 prebuilds,
  bundle the poppler binaries for both platforms, provide packaging/launch scripts.
- Archive convention: finished process documents (completed task prompts and results,
  audits, reviews, rehearsal/measurement history) go to `archive/` at the repository root,
  which is git-ignored: carry open findings into HANDOFF.md or `docs/product`/`docs/impl`,
  then `git rm --cached` and `mv`. Tracked files never link into `archive/`.
- Docs to maintain: `docs/impl/` (architecture and mechanisms), `docs/product/`, `docs/tasks/DECISIONS.md`, `docs/tasks/LEGACY-SURVEY.md`
  (feature inventory of the old app — the completeness checklist), `docs/tasks/ROADMAP.md`
  (milestones with status), `docs/tasks/HANDOFF.md`, `README.md`.
- UI language follows the legacy app's user-facing language.

## Session protocol

1. Read this file + HANDOFF.md (+ ROADMAP.md). 2. Advance as many milestones as you safely can.
3. When your context is getting heavy (or a natural milestone boundary is reached after a lot
of work), stop: make sure changes are committed and pushed, record the exact CI status, update HANDOFF.md/ROADMAP.md, and
return a ≤15-line report: what was done, what is next, Codex quota status, and `STATUS: DONE`
only if the whole roadmap including final polish, migration tooling and full verification is
finished — otherwise `STATUS: CONTINUE`. Report honestly: failing or unverified things are
stated as such.

## Owner feedback, session 4 (2026-10-13) — supersedes the text above where they differ

1. **UI/UX will be redesigned from first principles in a dedicated Claude-led session after
   core functionality is finished.** The owner finds the current UI ugly, untidy and
   inconsistent, with poor UX. Spend no Codex on cosmetics until then. Keep core functionality
   working end to end and keep UI logic cleanly separated from presentation so the redesign is
   cheap. The project is not DONE before that redesign.
2. **Test suite**: only three kinds of tests are worth keeping — (a) gates; (b) thorough tests
   of complex-logic modules (add coverage where thin); (c) end-to-end per feature module:
   front-end e2e for complex features (chat …), backend-only API availability tests for simple
   ones (music …). Trivial, tautological, mock-echo, snapshot-of-markup and duplicate tests
   are deleted. UI-coupled tests will be rewritten by the redesign: prefer semantic/stable
   e2e selectors.
3. **Packaging targets**: `win32-x64`, `linux-debian`, `linux-redhat` — two separate Linux
   build/package targets instead of one Linux artefact probing pdfrender flavours at runtime.
4. **pdfrender** may be compiled from source by us and its internal format may change if that
   makes the document pipeline better; the vendored binaries/format are no longer binding.
5. **Docs layout**: `docs/tasks/[id]` = implementation process (task prompts, results,
   handoffs, audits); `docs/product/` = product design (goals, features, UX design);
   `docs/impl/` = how it is implemented (code logic, design patterns — not a 1:1 mirror of the
   code); root `AGENTS.md` = lets an AI learn the workflow quickly (charter + handoff reachable
   from it). Process, index and semantic-anchor content must not be mixed.
6. **Code organisation**: restructure wherever it helps; do not shy away from the effort.
   Logic modules may be split very finely. Things must NOT live together merely because they
   look similar while being unrelated (shared `utils`/`helpers`/`common`, catch-all
   `services`/`types` files, one module hosting several unrelated features) — that causes
   inexplicable coupling later. Group by what actually depends on and changes with what; use
   separate directories to signal isolation semantics, enforced by `tools/boundaries.mjs`.
   Codex audits every package for accidental co-location and grab-bag modules, proposes the
   split (astra/high for audit/plan), then carries it out (mechanical moves: sol/medium).
   Done BEFORE the test-suite review; resulting layout + rationale documented in `docs/impl/`.

Priority order: core functionality complete and verified (audit findings, real-data
migration, Chromium 70, packaging) → 3/4 → 6 → 2 → 5 → UI redesign session.
Budget note (session 4): a fresh weekly Codex window started at 0 %; the owner advises not
to use all of it and to stop when work is not clearly improving the product.
