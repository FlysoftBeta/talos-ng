# Roadmap

Status: `todo` · `wip` · `done` · `verified` (done + independently checked by the orchestrator).
Each milestone is green on `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before it is
marked done. F-ids refer to `LEGACY-SURVEY.md` §2. Task prompts live in `docs/tasks/`.

| # | Milestone | Scope | Depends | Status |
|---|---|---|---|---|
| M0 | Survey + design | LEGACY-SURVEY, ARCHITECTURE, DECISIONS, ROADMAP | — | done |
| M1 | Scaffold + `@talos/base` | workspace, tsconfig/eslint/vitest, boundary lint, root scripts, compat-check skeleton, base primitives | M0 | verified |
| M2 | `@talos/link` | frames, LinkClient FSM, LinkServer, memory + ws carriers | M1 | verified |
| M3 | `@talos/objectstore` | fs + memory backends, stages, fsck helpers | M1 | verified |
| M4 | `@talos/docpack` + `@talos/docpipe` | TDP format, pdf (pdfrender) + text converters, vendored binaries, real-PDF tests | M1 | verified |
| M5 | `@talos/store` | IndexedDB engine, tables, notifications, FileStore, Blob guard | M1 | verified |
| M6 | `@talos/sync` | Lww/Max, IntervalSet, cursor/delta application, outbox FSM | M1 | verified |
| M7 | Server kernel + `@talos/contract` core | config, Db adapter + migrations, uow, rev, syncHub, events, jobs, objects ledger, upload calls, HTTP gateway, link host, incidents/audit | M2 M3 | verified |
| M8 | Walking skeleton | `@talos/shell` (SW + installer), client core (link, session, sync engine, outbox, nav), design system, status centre; login → empty app; offline boot; Chrome 70 smoke; compat-check complete | M5 M6 M7 | verified (tasks 021+022; 16 real-server scenarios on current Chromium and Chromium 70) |
| M9 | Identity & admission | F-001…F-011, F-045…F-050, device/whitelist/binding/throttle, roles + gates | M8 | verified (task 030; 27 real-server scenarios on both browsers) |
| M10 | Community & chat | F-012…F-044 (groups, DMs, posts, images, stickers, banners, announcements, retention) | M9 | verified (task 040 + 045 compaction; 16 chat scenarios current, 5 on Chromium 70; screenshots reviewed) |
| M11 | Library & reader | F-051…F-069 minus network novels (documents, collections, sharing, reader, progress, retention, tasks UI) | M4 M10 | verified (task 060; real-PDF + 500-page + offline e2e on both browsers; F-063 eviction and F-065 anchoring finish in task 130) |
| M12 | Learning | F-070…F-080 | M9 | removed by owner instruction (D-144) |
| M13 | Media | F-081…F-092 (yt-dlp provider, playlists, queue, player, audio cache) | M11 | done (task 080, fake-provider e2e on both browsers; live yt-dlp not exercised; UI polish = task 111) |
| M14 | AI | F-093…F-101, F-124, F-125 | M10 | done (task 085; fake-provider e2e; Mermaid shown as labelled source on Chrome 70 (D-088); live upstream unverified) |
| M15 | Admin workbench | F-102…F-123, F-136…F-141 | M10 | done (tasks 070 + 071; 25 F-ids done, 3 changed by design) |
| M16 | Ops, launcher, packaging | F-126…F-135, F-142; backups incl. objects, update/rollback, HTTPS, host tools, Office capture; Windows + Linux artefacts | M8 | done (task 090 + integration; packaged Linux A→B→rollback e2e green; Windows only under Wine; panels await M15 mounting + polish) |
| M17 | Network novels | F-058, F-059 (tomato provider as jobs) | M11 | done (task 100; fake-provider e2e; the one live smoke against the real provider FAILED with an empty upstream verification response — real downloads unverified) |
| M18 | Hardening | quota/eviction, offline E2E matrix, real Chromium 70 run of every area, security review, constraint audit | all above | done (tasks 130, 142, 148; visual polish dropped — replaced by M22) |
| M19 | Legacy data migration | importer from legacy `data.db` + blob store | M18 | done (tasks 120, 121, 143; rehearsed on real data — text documents/posts/users/words only; PDFs, images, media, AI verified on synthetic fixtures only) |
| M20 | Final audit | completeness audit of every F-id, hard-constraint audit, three package targets | M19 | done (tasks 141, 142, 145, 146; native Windows and Debian execution unverified) |
| M21 | Restructure, test review, docs | execute the task-147 structure plan (54 WPs); test-suite review; docs into `tasks/` · `product/` · `impl/` | M20 | done (tasks 149a–z, 150, 151; ratchet exceptions empty; 1,740 tests) |
| M22 | UI redesign | from-first-principles redesign in a dedicated Claude-led session | M21 | todo |

Parallelism: M2–M6 are mutually independent (disjoint packages, separate git worktrees).
M9–M17 touch disjoint server modules / client features and can run two or three at a time once
M8 has fixed the patterns; each such task must add its migrations/contract entries in its own
files to keep merges trivial.

## Completeness ledger

Filled in as milestones land: for each F-id — `done` / `changed (D-nnn)` / `dropped (D-nnn)`.
Kept in `docs/tasks/COMPLETENESS.md` from M9 onwards.
