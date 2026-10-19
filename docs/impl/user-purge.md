# User purge

Entry points: `packages/server/src/app/user-purge.ts` (coordinator),
`packages/server/src/app/compose-user-purge.ts` (participant composition),
`packages/server/src/kernel/persistence/user-purge.ts` (participant ports), each module's
`purge.ts`.

## Goal

Deleting a user removes the account and everything it owns, atomically, without letting any
module reach into another module's tables. Historical audit rows keep their actor id.

## Mechanism

1. **Admin authorises and enqueues.** `admin.user.purge` checks self and last-root safety,
   audits, and enqueues a durable `admin.user.purge` job (`onBoot: requeue`, retryable).
   The admin module contains no deletion logic.
2. **Preparation (own transaction).** The coordinator, living in `app/`, re-checks that the
   target is not the last effective root, then commits the identity `purging` gate and the
   revocation of sessions and download tickets. The gate stays if later steps fail: a failed
   purge never restores admission (the workbench shows such a user as deactivated and the job
   stays retryable). Status updates cannot clear the gate.
3. **Quiesce.** Before the final transaction the coordinator cancels the user's jobs and
   awaits their cleanup, drains admitted link requests and provider work for that user, and
   waits for the upload sequencer. Job admission/retry/start and upload admission reject
   gated owners; media discovery and AI image completion re-check admission.
4. **Final deletion in one outer unit of work.** Every participant's `purgeUser(user, tx)`
   runs synchronously inside a single `Uow.write`, all participants first and **identity
   last**; the last-root check runs again inside. All domain cleanup therefore shares one
   revision, and a failure anywhere (including a participant returning a thenable, which is
   rejected) rolls back everything: nothing is half-deleted and nothing is published to sync
   or after-commit effects.

## Participants

Each owner exposes a `UserPurgeParticipant {owner, purgeUser(user, tx)}` that touches only its
own tables through its own repository: identity, community, chat, ai, netbooks,
library, media, me, authority, plus kernel `jobs` and `uploads`. Cross-owner effects go through
explicit ports passed in by the composition root: object references are released through the
ledger (`removeOwnerRefs`; bytes are reclaimed by the normal sweep), grant revocation goes
through authority (updating every recorded recipient projection), membership changes notify
chat and authority. Registering a duplicate owner is a conflict. Participants must be
synchronous; netbooks chapter rows are removed by the download row's cascade.

The SQL ownership gate asserts that no purge file references a foreign table. A large purge
holds the synchronous write transaction for the duration of the deletion (seconds for tens of
thousands of posts); it is deliberately not chunked, to keep atomicity.
