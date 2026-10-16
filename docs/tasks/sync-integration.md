# AI sync integration fixture repair

Prompt: investigate the integrated AI streaming regression after sync push failure
recovery. Preserve meaningful streaming coverage; repair production only if the
application wiring is wrong. Work on isolated m/sync-integration; do not push.

Finding: the AI fixture creates Jobs and routes every committed job change into
SyncHub, but omits the task module's job serializer/provider. Production registers
createTasks before AI. The first job enqueue therefore causes E_INTERNAL and the
new recovery behavior correctly suspends the incomplete fixture subscription.

Result: fixture now calls the production createTasks registration; no production
behavior changed. The original stream event count assertion remains, with explicit
checks for no sync errors and emitted running/completed assistant rows. Before the
fix, the focused test reproduced E_INTERNAL (unregistered sync entity). Afterward,
all AI tests pass: 5 files / 64 tests. Server test typecheck, scoped ESLint, format
and diff checks pass. Parent owns the integrated full gates.
