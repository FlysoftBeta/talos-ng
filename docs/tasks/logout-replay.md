# Logout replay session isolation

Fix the confirmed idempotency defect where replaying a completed `auth.logout`
operation revokes a newer session on the same device. Keep the completed operation
result and restore only the connection's logged-out binding. Add a real-kernel
regression covering old-token revocation, connection concealment, and survival of
the newer token. Own `create-application.ts` and the integration regression only.

Validate targeted integration tests, server typechecks, and changed-file lint.
Commit on `m/logout-replay`; do not push or merge. Requested by the parent during
the authorized sync/error/retry audit fixes.
