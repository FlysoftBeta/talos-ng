# File ownership and download error audit

Scope: audit personal retained file writes, account/generation changes, access revocation,
and ranged HTTP errors as part of the user-requested sync/retention repair.

Implemented: session fences before and after asynchronous storage mutations; release only
captured old-user leases; validate retained item ownership against currently admitted rows;
classify HTTP authorization, missing content, throttling, and unavailable service errors;
cancel unread responses without masking the original error.

Validation: focused controller and ranged-download suites 34 tests pass; client production
and test typechecks pass; changed-file ESLint and formatting pass. No current schema change.
