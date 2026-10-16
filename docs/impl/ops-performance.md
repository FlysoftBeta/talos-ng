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

## Server: statement tracing and slow queries

Every SQLite statement and every outer transaction is timed on the writer and on each sync
replica. Statements are aggregated by **normalized SQL** (literals become `?`, placeholder and
tuple lists collapse to `?…`), transactions by their **call site** (`Posts.send @
modules/chat/posts/service.ts:42`; `server.js:<line>` plus the function name in a release).
Per shape: count, total, p50/p95 (log-bucketed, within a quarter power of two), maximum and
the number of slow executions; at most 400 shapes are tracked and the rest counted as
dropped. Bound parameters are never recorded.

- **Threshold:** `slowQueryMs` / `TALOS_SLOW_QUERY_MS` (default 50 ms). A slow execution is
  kept in a ring of the last 50 and written to the server log as `慢查询` (warn) at most once
  per shape and minute.
- **Event loop:** main-thread delay (p50/p99/max of a 10 ms timer histogram) and utilisation;
  a long synchronous transaction or pull shows up here even when no single statement is slow.
- **Admins:** workbench section 性能 (`admin.performance.get`, operations role) shows the
  window since the last reset: summary, statements by total time, recent slow queries and
  replica status. 重新计时 returns the closed window and starts a new one (audited).

How to read it: high `count` with small p50 on a point lookup is an N+1 inside a loop (look
at the transactions or callers that run it); a large p50 on `... ORDER BY rev,id` without a
`WHERE` is a full scan; transactions far slower than their statements are JavaScript work
inside the unit of work. Verify a suspected missing index with `EXPLAIN QUERY PLAN` on a copy
of the database.

## Server load measurement

`node --import tsx packages/server/bin/testing/sync-load.ts --data .tmp/load [--users 400]
[--groups 40] [--members 40] [--posts 40] [--readers N] [--writes 200]` seeds a community
once into the data directory (users with known PINs, groups, posts; reused on later runs),
starts the real server as a child process, logs every user in over WebSocket and prints, per
phase, client latencies, the event-loop figures and the top statements from
`admin.performance.get`: login, initial sync of all clients at once, reconnect pulls with
cursors, and live posts while everyone is subscribed. `LOAD_SERVER_NODE_OPTIONS="--cpu-prof
--cpu-prof-dir=..."` profiles the server. Clients share the machine with the server, so
absolute numbers are pessimistic; compare runs on the same host.

### Current numbers (4-core Linux VM, Node 22, clients on the same host)

Seed: 400 users, 40 groups × 40 members, 40 posts per group; every user is also a member of
the two system conversations, so an initial sync carries ~800 member rows per client.
Client wall time for all 400 clients at once, and main event-loop p99:

| Phase | 0 replicas | 3 replicas |
| --- | --: | --: |
| Initial sync | 18.2 s (loop p99 10.4 s) | 7.8 s (loop p99 2.6 s) |
| Reconnect pull with cursors | 1.4 s (loop p99 1.1 s) | 0.31 s (loop p99 0.12 s) |
| 200 posts sent at once, all subscribed | 1.26 s | 1.37 s |

Before the hot-spot fixes the same seed did not complete: the main thread blocked longer
than the 45 s link dead-timeout and clients disconnected. At 60 users / 8 groups the fixes
alone took the initial sync from 10.3 s to 3.9 s, a reconnect pull round from 12.0 s to
0.39 s and 30 posts from 6.6 s to 0.32 s. Remaining main-thread cost under load is result
validation and frame encoding of large pull responses and per-connection delta encoding;
the initial-sync volume is dominated by the system conversations' member lists.
