# Object store, ledger and uploads

Packages: `@talos/objectstore` (Node, depends on `base` only; knows nothing of SQLite, users or
documents), server `kernel/objects` (ledger, uploads, tickets, inventory). Entry points:
`packages/objectstore/src/index.ts`, `packages/server/src/kernel/objects/objects.ts`,
`uploads.ts`, `tickets.ts`.

## Object store

Bytes addressed by SHA-256 (64 lowercase hex). One interface, two backends (filesystem,
memory) that both pass the shared conformance cases from `@talos/objectstore/testing`.

```ts
put(src: Uint8Array | AsyncIterable<Uint8Array>, expect?): Promise<ObjectInfo>
stage(stageId): Promise<Stage>      // resumable append-only upload; reopen by same id
has / stat / read(id, range?) / readAll / open(id) -> RandomAccess / localPath(id) / delete
list / verify(id) / sweepStages(olderThanMs)
Stage: append(chunk, atOffset), commit(expect?), abort()
```

Filesystem layout: `<root>/objects/ab/cd/<sha256>`, `<root>/stages/<stageId>`,
`<root>/trash/…`. Guarantees:

- **Publication is atomic.** `put` hashes while streaming into a private stage, checks
  expectations, flushes, then renames into the fan-out; no partial file is ever visible.
  Identical content is a no-op (expectations are still verified).
- Stages: `append(bytes, offset)` accepts only the current size (conflict returns the actual
  size so the client resumes); `commit` re-hashes the whole stage and keeps it on integrity
  mismatch; `sweepStages` treats its argument as an age.
- Default durability fsyncs files before publication and appends before acknowledgement,
  plus directories on Linux. Windows has no portable directory fsync from Node, so it
  flushes files and relies on atomic rename: a crash may lose recent directory entries but
  never exposes a torn file.
- **Windows-safe deletion**: no rename over open files; `delete` retries on `EBUSY/EPERM`,
  then moves the object to `trash/` for a later `sweepTrash`; if even that fails it returns
  `E_BUSY` and keeps the object. No POSIX modes, symlinks or hard links are relied on.
- Identifier validation happens before any filesystem access; `localPath` only serves
  read-only child processes (pdfrender); published objects are never edited.
- One active store per root, injected through the kernel; no cross-process locking.
- Errors: `E_NOT_FOUND`, `E_INTEGRITY`, `E_CONFLICT`, `E_BUSY`.

### Bulk ingestion

`beginObjectBatch(store)` is for offline imports and catalog seeding: sequential `put`s
without per-object sync, then `commit` flushes every touched file (at most 32 concurrent)
and directories bottom-up. **Durability precedes references**: only after `commit` succeeds
may the caller commit ownership/catalog/journal rows in one transaction; a failed commit must
not be followed by a reference commit. The caller excludes GC for the batch lifetime.
Interrupted batches leave replayable orphans; replay hash-checks existing files and repairs
torn copies. Normal uploads keep per-object durability. Startup catalog seeding verifies
stored references and reseeds missing or corrupt assets idempotently. Offline imports leave
background jobs stopped so resumed conversions cannot race object batches.

## Ledger (server kernel)

`objects(id, size, created, last_ref_change)` + `object_refs(object_id, owner_kind,
owner_id)`; it fixes the "every domain must reconcile its own leaks" class of bugs with one
owner of reference tracking and a real GC.

- Modules `register`/`addRef`/`removeRef` inside their own transaction (an active `Uow` is
  required); `publish` serialises new object publication against GC so a module never races
  a direct store write against a sweep.
- `sweep()` deletes objects with no references after a grace period (24 h default) and
  reserves them while deleting. `fsck()` reconciles ledger and store both ways (imports
  orphan bytes, reports missing or corrupt objects without discarding references) and is
  exposed to operations.
- The ledger also answers the object inventory (`ledgerInventory`) for any database holding
  its table, including a read-only backup snapshot, so backup code names no foreign table.
- Per-owner reference removal (`removeOwnerRefs(kind, id)`) is how user purge releases
  bytes; physical bytes are reclaimed by the normal sweep.

## Uploads

`UploadService` is owner-scoped `begin/append/commit/abort`, driven by link calls and built on
`ObjectStore.stage`:

- `begin` takes an optional existing upload id and returns the current offset (resumable);
  declared size and optional SHA-256 are immutable; per-kind size limits are contract
  constants. `append` bodies are at most 512 KiB at the current offset; `commit` validates the
  declared size/hash.
- A committed upload holds an `upload:<id>` reference for 24 hours until a module `claim`s it
  inside its own transaction (the domain write and the reference transfer commit together)
  or it expires. Maintenance sweeps expired uploads and stages every minute.
- Upload admission rejects owners under purge, and purge waits for the upload sequencer to
  drain before its final transaction.

## Tickets and object access

`TicketService` mints short-lived download capabilities (see `link.md` for the gateway side).
Whether a user may download an object is answered by one function composed in `app/`
(`object-access.ts`) from per-module predicates (library, media, uploads, ops office/backup,
admin incident downloads), each combined with the actor being an active user and the
relevant authority action; modules never reach into each other's tables for this.
