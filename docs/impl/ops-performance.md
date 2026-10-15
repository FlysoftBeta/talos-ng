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
