# Logout replay result

Replaying a completed logout now clears the current connection binding without
revoking a newer session. The original operation already revoked its requested
token. Previously the replay hook discarded that explicit token and called logout
against the connection's current session instead.

Confirmed before the change using a real in-memory kernel and Link transport:
login A, logout A with operation X, login B, replay logout A/X; resuming B failed
with `E_UNAUTHENTICATED`. The new integration regression also verifies that A stays
revoked and the replay clears the current binding while B remains resumable.

Validation in this worktree:

- `node node_modules/vitest/vitest.mjs run packages/server/src/integration.test.ts --maxWorkers=2`: 8 passed.
- `node tools/typecheck.mjs -p packages/server/tsconfig.json`: passed.
- `node tools/typecheck.mjs -p packages/server/tsconfig.test.json`: passed.
- ESLint and Prettier for both changed source/test files and task documents: passed.

No public API change. Ordinary UI logout does not currently supply an operation
key, so this fixes supported API replay behavior without claiming it caused the
reported users' production symptoms. No full browser/package gates run for this
isolated server fix; integration gates remain the parent's responsibility.
