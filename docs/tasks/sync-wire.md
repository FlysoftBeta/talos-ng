# Sync wire payload repair

Prompt: repair legal large library revision groups (up to 1000 documents), large
learning corpus rows (up to 512 KiB), and oversized push loss. Preserve revision
atomicity and bounded transport headers. Coordinate the optional transfer/repull
contract with the sync-client task. Own contract sync protocol, kernel sync and
focused regression tests; do not edit retention services. Commit; never push.

Approach: bounded JSON transfer continuation for an oversized logical page,
connection/user binding and expiry, access checks on every chunk, and an ordinary
catch-up pull when relevant writes occur during transfer before subscription. Oversized or failed pushes disable incremental
push until authoritative pull and request repull. Verify frame bounds including
JSON escaping, exact large payload reconstruction, access and concurrent writes.

Results:

- Legal 1000-document transactions and a corpus larger than the link header now
  synchronize over bounded fragments with byte-for-byte payload reconstruction.
- Full response size includes scope metadata, JSON escaping and multibyte text;
  a 4000-scope metadata-only snapshot converges even if empty writes bump revisions.
- Rotating continuations are user/connection bound, expire after 60 seconds of
  inactivity, reject replay/revocation, and are cleared by disconnect. Relevant
  writes during transfer request catch-up; clean completion activates subscriptions.
- Oversized/failed push requests authoritative pull and suppresses later deltas
  until recovery, preventing a later cursor from skipping a missing transaction.
- Verified: server and contract production/test typechecks; ESLint on changed TS;
  formatting and diff checks; boundaries (zero exceptions); focused Vitest run
  (sync hub, large wire integration, learning, contract): 5 files / 47 tests pass.
- Read-only audit of session identity/continuation lifecycle found no blocker.
- Parent owns integrated client testing and full main gates. Existing request-side
  cursors map still shares one 256 KiB header; extreme scope counts remain limited
  by that request capacity. No full browser or packaging gate run in this worktree.
