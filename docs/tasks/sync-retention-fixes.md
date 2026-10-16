# Sync correctness and personal offline retention

User request: repair selective sync failures with regression tests; audit errors and retries;
make book, song, booklist and playlist offline retention personal settings; discard prior
configuration; no current-app schema migration, update legacy importer only. Commit and push
main, monitor CI and fix failures.

Work units use isolated worktrees: sync-wire, sync-client, retention-server,
retention-client, file-audit. Integration must cover two-user access isolation, large legal
payloads, concurrent push/pull, terminal/transient errors, session changes, and expiry.
Required gates: pnpm check, pnpm e2e, pnpm e2e:legacy, pnpm package. Track exact limitations.

Quota command unavailable in this environment (authentication failure); no credential changes.
