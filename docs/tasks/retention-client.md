# Personal offline retention client

Task: expose personal offline choices for documents, booklists, tracks and playlists,
including shared collections with read-only access. Remove collection-owned retention
and keep download, expiry, eviction and account switching consistent. No current-app
schema migration; old policies are deliberately discarded.

Implementation decisions:

- Personal libraryRetention/mediaRetention rows contain target kind/id, LWW auto or
  1–365 day choice and a personal lastUsed clock. Auto contributes no explicit pin.
  An accessible item inherits the maximum deadline of its own choice and all chosen
  containing lists; setting an item to auto does not override an explicit list pin.
- The deadline starts at the later of choice time and personal use. A track play and
  reading a document from a booklist record personal clocks without changing shared
  entities. All four controls remain available with read-only source access.
- Serialized schedulers register incomplete ownership before download; every async
  boundary checks account/cancellation before further mutations or progress. A new
  policy pass cleans up partial data. Expiry, changed membership and lost access
  release pins. Cached bytes are explicitly retained. Storage/download errors are
  visible and retried after 30 seconds; successful passes schedule the next expiry.
- Quota eviction reads authoritative per-user policies and current membership, never
  stale scheduler bookkeeping or other accounts' policies. Policy/membership changes
  during candidate discovery are checked again inside deletion transactions.

Verification results will be appended before commit. Backend contracts are supplied
by the parallel retention-server task; file-session fencing is supplied by the parent.

Results:

- Client production and test typecheck, ESLint/CSS check, production build and static
  Chrome 70 scan passed (zero violations). Boundary ratchet passed.
- Focused library, media, reader and quota-eviction suite passed 123 tests; one further
  stale shared-row/direct-pin eviction regression was added and passed in the focused
  30-test scheduler/eviction rerun. Final combined rerun covers 124 tests.
- Current Chromium media feature e2e passed, including individual song controls,
  personal playlist retention, offline playback/intent replay, a read-only recipient
  defaulting to no download, recipient's independent choice, owner's unchanged choice,
  and shared-playlist revocation reclaiming local audio.
- Library e2e passed text-reader retention before PDF conversion timed out: vendored
  pdfrender could not load libjpeg.so.8 in this Debian environment. Hardening passed its
  offline matrix and was stopped before its PDF-dependent performance section for the
  same reason. Parent supplied the native library afterward and will rerun integrated
  gates with LD_LIBRARY_PATH; these two e2e features are not claimed green here.
- Per-object outbox orderKey callbacks coordinate library doc/list policies and media
  track/list choices with the parallel sync-client hook. Queue and stop-at-end have
  independent barriers; malformed target arguments use the conservative fallback.
- Backend commit ab57343 was cherry-picked locally for verification; client commit
  excludes those files. Parent owns final integration and file-controller session,
  membership checks and no-progress network timeout changes.
