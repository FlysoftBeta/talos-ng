# Performance: measuring and current numbers

## How to measure

`node tools/e2e/run.mjs hardening` (after building the shell and client, e.g. via `pnpm e2e`)
runs the performance scenario on current Chromium with CDP CPU throttling ×6 against a real
server holding 500 posts, 500 PDF pages and 2,000 additional users. It writes the table to
`.tmp/e2e/PERFORMANCE.md` (ignored by git) and fails the run when a budget is exceeded:
2000 ms for load scenarios (SW boot, conversation, PDF, grid) and 200 ms for the longest
long-task during scroll samples. Scroll samples drive 12 animation frames and allow 250 ms for
observer delivery; zero means no Long Tasks API entries (tasks of at least 50 ms), not zero CPU
work. SW boot measures the interactive concealment screen; PIN entry is excluded.

## Current numbers (HeadlessChrome 156, ×6 throttling)

| Scenario                         |  ms |
| -------------------------------- | --: |
| SW boot                          | 438 |
| 500-post conversation            | 968 |
| Conversation scroll longest task |  53 |
| 500-page PDF                     | 810 |
| PDF scroll longest task          |   0 |
| 2000-user grid                   | 238 |
| Grid scroll longest task         |   0 |

These are throttled current-Chromium measurements, not Chrome 70 or native-tablet timings;
re-measure on deployment hardware before setting a latency SLO.

## Disk first boot and bulk import

Single runs on Linux / Node 22 with scratch on NVMe btrfs (never tmpfs): catalog seed of 1,062
stickers (50.5 MB) takes 2.97 s in one transaction; real-server first start is about 4.9 s and
restart about 1.1 s (untraced). Bulk ingestion writes objects first, then does one bounded file
sync pass and a bottom-up directory sync pass, and only then commits catalog or import
references; migrations within a module share a transaction; catalog restarts hash-verify
existing files and repair partial or missing ones from the bundled assets. Offline migration
builds its kernel with background execution disabled, so imported conversion jobs stay queued
for the real server boot. Windows uses the same sync pass and skips unsupported directory
fsync. Historical before/after measurements are process material in the (untracked)
`archive/`.

## Server: query plans

Hot statements are checked with `EXPLAIN QUERY PLAN`, not timed at run time. The gate
`packages/server/src/app/query-plans.test.ts` records every statement prepared while a user
pulls, a post fans out and the user pulls again, explains each one and fails on a `SCAN` of a
table that grows with users or content, or on a temporary B-tree for `ORDER BY`
(`UNION` results excepted). Known bounded scans are listed there with their reason.

Rules the schema follows: a revision-paged query `WHERE <scope>=? AND rev>? ORDER BY
rev,<id> LIMIT ?` needs an index on `(<scope>, rev, <id>)`, otherwise SQLite sorts the
scope's rows for the tie-breaker; foreign-key children need an index on the referencing
column or every parent delete scans them; access lists (conversations, collections,
playlists) start from the user's memberships, ownerships and grants instead of filtering
every row.

To check a statement by hand, open a copy of a production database with `sqlite3` and run
`EXPLAIN QUERY PLAN <statement>` with literal values; `SEARCH ... USING INDEX` is the
goal, `SCAN` on a large table or `USE TEMP B-TREE` is a finding.

## Server: sync replicas under load

Measured once with an ad-hoc load script (400 users, 40 groups × 40 members, 40 posts per
group, every user also in the two system conversations; 4-core VM, clients on the same
host). Client wall time for all 400 clients at once and main event-loop p99:

| Phase | 0 replicas | 3 replicas |
| --- | --: | --: |
| Initial sync | 18.2 s (loop p99 10.4 s) | 7.8 s (loop p99 2.6 s) |
| Reconnect pull with cursors | 1.4 s (loop p99 1.1 s) | 0.31 s (loop p99 0.12 s) |
| 200 posts sent at once, all subscribed | 1.26 s | 1.37 s |

Before the fan-out and provider fixes the same seed did not complete (main thread blocked
past the 45 s link dead-timeout). Remaining main-thread cost under load is result
validation and frame encoding of large pull responses; initial-sync volume is dominated by
the system conversations' member lists.
