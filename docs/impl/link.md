# Link transport, API contract and HTTP gateway

Packages: `@talos/link` (transport), `@talos/contract` (method registry), server
`kernel/transport` (link host, HTTP gateway). Entry points: `packages/link/src/index.ts`,
`packages/contract/src/index.ts`, `packages/server/src/kernel/transport/link-host.ts`.

## Why an own protocol

The application does not use HTTP semantics (methods, status codes, cookies, caching,
multipart, range) for its API. One WebSocket carries RPC, uploads, downloads and live events,
so a managed tablet needs a single connection, business denials are error codes rather than
HTTP statuses, and tests run the same code over an in-memory carrier. A **carrier** is any
ordered, reliable, message-oriented binary duplex (production: one WebSocket at `/link`;
tests: a memory pair). The core `link` package depends only on `base`; the WebSocket
adapters are separate subpaths (`@talos/link/ws-browser`, `@talos/link/ws-node`), so
importing the core never loads `ws`.

## Frame

One carrier message is one frame: `u8 type`, `u32 headerLen` (big-endian), a UTF-8 JSON
header, then an opaque body.

| Type | Header |
|---|---|
| 1 HELLO (c to s) | `{v:1, build, device: string or null, lang}` |
| 2 WELCOME (s to c) | `{v:1, build, now, device, conn}` |
| 3 CALL (c to s) | `{id, m, a, op?}`; `op` is an idempotency key (ULID) |
| 4 REPLY (s to c) | `{id, ok:true, d}` or `{id, ok:false, e:{code, message, data?}}` |
| 5 EVENT (s to c) | `{t, d}` |
| 6 PING / 7 PONG | `{n}` |
| 8 CANCEL | `{id}` |
| 9 BYE (either way) | `{code, message?}` |

Header at most 256 KiB, frame at most 4 MiB (configurable, set equally on core and adapter).
A malformed frame closes the carrier with BYE `E_PROTOCOL` whenever the carrier can still
transmit; unknown header fields are ignored so extensions stay compatible. Text WebSocket
messages and oversized payloads are rejected by the adapters before a link frame exists and
therefore cannot carry a BYE.

**No stream frames.** Bulk bytes travel as bodies of ordinary calls of at most 512 KiB.
Flow control is "await the reply" with a small pipelining window; resumability is an offset.
`uploadChunks` / `downloadChunks` implement this: increasing offsets, window 3 by default,
downloads commit writes in offset order even if replies arrive out of order, progress is the
contiguous confirmed offset, errors cancel sibling calls, nothing retries. The caller owns
begin/commit/checksum and durable resume metadata.

## Client (`LinkClient`)

Explicit FSM: `idle, connecting, open, waiting (backoff), versionMismatch, stopped`.
Backoff 0.5 s to 10 s with 20% symmetric jitter, reset only after WELCOME; connect including
HELLO/WELCOME times out after 8 s; PING every 20 s, any valid frame refreshes a 45 s silence
deadline. `stopped` and `versionMismatch` are terminal (a new client is built after an update).

**The transport never queues or retries.** A call while not `open` rejects at once with
`E_OFFLINE`; calls in flight when the carrier drops reject with `E_DISCONNECTED` (outcome
unknown, so callers that need exactly-once pass `op`). Durable intent is the outbox's job
(see `sync.md`), with exactly one owner. Timeout (30 s default) and cancellation both send
CANCEL; late replies after that are ignored. Request ids increase without reuse per
connection.

All timers, clock, randomness, connection factory and HELLO factory are injectable. Signals
use base's structural `CancellationSignal` (compatible with Chrome 70).

## Server (`LinkServer`)

Carrier-agnostic: `accept(carrier, info)` creates a pending connection with a provisional
id; the admission hook's WELCOME supplies the final `conn` id and device, and only
handshaken connections appear in `connections`. Unsupported versions get `E_VERSION` before
admission. Per connection: in-flight cap 16 (excess `E_BUSY`), HELLO timeout 5 s, idle
timeout 45 s. CANCEL aborts the handler's native `AbortSignal` but the capacity slot stays
taken until the handler settles, so uncooperative handlers cannot defeat the cap. Thrown
`AppError`s become error replies; anything else becomes `E_INTERNAL` with an incident id from
the injected reporter (raw messages and stacks never enter replies). Validation and auth are
layered on by contract and kernel, not by `link`. Closing the link server before the adapter
and the HTTP server gives peers a BYE.

## Error codes

Shared in `@talos/base`: `E_OFFLINE, E_DISCONNECTED, E_TIMEOUT, E_CANCELLED, E_PROTOCOL,
E_VERSION, E_BUSY, E_INVALID, E_UNAUTHENTICATED, E_DENIED, E_NOT_FOUND, E_CONFLICT,
E_RATE_LIMITED, E_LOCKED, E_UNAVAILABLE, E_TOO_LARGE, E_INTEGRITY, E_INTERNAL`. `message` is
user-presentable Chinese produced by the server; the client has per-code fallbacks. A
business denial is never `E_INTERNAL`. `AppError` and `Result` live in `base`; `AppError`
serialises code, message and data, never the stack.

## API contract (`@talos/contract`)

One typed registry shared by server and client:

```ts
defineMethod({ name: 'chat.post.send', args, result,
  auth: 'user' | 'device' | 'public', offline: 'queue' | 'online', body?: 'in' | 'out' })
defineEvent({ topic, data });  defineEntity(...)
```

Method names are `module.noun.verb`. The registry also holds entity schemas (synced row
shapes), sync scope definitions, feature gates, role enums with dependency rules (shared
`hasFeature` / `rolesWithDependencies` so server and client agree), and limits as named
constants. Registry objects are frozen. Rules:

- `offline` decides the client path: `queue` goes through the outbox with an optimistic
  reducer, `online` needs a live connection and the UI disables it offline with a reason.
- Compatibility is one integer `CONTRACT_VERSION` plus the build id; a mismatch makes the
  client update itself rather than negotiate. Bump it for incompatible wire changes.
- The client derives a typed proxy (`createApi(link.call.bind(link))`) that validates replies.
  Binary bodies go through the underlying `LinkClient` explicitly.
- Settings travel as complete LWW registers `{v,t,op}`; keys are bounded opaque preferences
  and can never grant roles or features.
- Upload `begin` takes an optional existing upload id for resumability; declared size and
  optional SHA-256 are immutable for the upload's lifetime.
- A credential version is returned in session replies and synced profile (see `identity.md`).
- Pinned Zod 3 contains BigInt validators; the build tolerates them only as unused code and
  fails if a schema uses bigint. New methods add fixtures to `packages/contract/compat.mjs`,
  which runs every schema in a VM with newer globals removed.

Adding a module's contract: `src/modules/<module>.ts` with strict Zod objects, register it in
`registry.ts`, export types from `index.ts`, test malformed data and client binding.

## Server link host

`LinkHost.register(contractMethod, handler)` validates arguments and results, enforces auth,
applies an injectable rate-limit hook and handles operation replay. Handlers get
`(context, args, body, signal)` where context carries connection, actor, device and op id.

**Operation replay.** A CALL with `op` stores its successful reply in `ops(op, user|device,
result, created)` for 14 days, keyed by user (or device for pre-login methods) with a request
fingerprint that rejects key reuse; in-flight duplicates share one promise. **Queueable
handlers must be synchronous**: their row writes and the stored reply share one `Uow`
transaction, so a crash cannot apply a write without its replay record. Asynchronous online
operations recover through their own resumable ids (upload ids). Before a device identity
exists, replay is scoped to the connection. Stored reply JSON is AES-256-GCM encrypted so
credential-returning calls do not leave plaintext session tokens in the ledger; the key lives
in the same database, so this guards against accidental inspection, not database theft.
Auth replay revalidates and restores the connection binding.

One session is bound per connection (`connection.ctx`); every call and every committed
fan-out rechecks session validity, so revoking a token invalidates sibling connections at
once.

## HTTP gateway (the only HTTP)

`node:http`/`node:https` with a hand-written dispatcher, no framework. Routes: `GET /` (shell
document), `GET /sw.js`, `GET /app/manifest.json`, `GET /app/<build>/<asset>`, `GET /link`
(WebSocket upgrade), `GET /dl/<ticket>`, `GET /ca.crt`, and an optional HTTP-to-HTTPS
redirect (301, `no-store`, so browsers never cache the redirect) sent only to user agents
that report Chrome/Chromium 80 or newer; older and unknown browsers keep the full HTTP
service, `/link` included. Unknown paths under `/app/`
or `/dl/` and an unconfigured `/ca.crt` answer 404; every other path (a stray link such as
`/business`) is a 301 to `/`, since the client has no path routes.

- `/`, `/sw.js` and `/app/manifest.json` are `no-store`; versioned assets are immutable.
  `/sw.js` is served with a JavaScript MIME type and `Service-Worker-Allowed: /`.
- The client release directory is read once at start: the manifest is validated, every
  listed asset is size- and hash-checked, and the bytes are served from that immutable boot
  snapshot. Only manifest entries are served (no gallery or build metadata); hidden files,
  symlinks and traversal paths are rejected. The manifest's build id is authoritative for
  WELCOME. A missing release directory serves an instructional 503 while the API continues;
  a malformed release or corrupt asset fails boot.
- `/dl/<ticket>` serves single-purpose byte downloads with `Range` for `<audio>`, ranged pack
  reads and save-to-disk. A ticket is a bearer capability bound to user, object, filename and
  MIME, valid five minutes and reusable for range requests; access is re-checked on every
  request, and logout, ownership removal or expiry invalidate it. Tickets are minted through
  link calls after the owning module's authorisation. Generated archives (backups) stream
  directly through the gateway and answer range requests with 416.
- Multi-port listening is configuration (`ports`, `securePorts`); there is no client-side
  multi-origin balancing because one multiplexed connection removes the per-origin limit.
- TLS: configured cert/key/CA; changed files reload a validated key pair without dropping
  listeners, an invalid replacement keeps the previous context and records an incident.
  `/ca.crt` stays reachable over plain HTTP.
- The WebSocket server is `ws` in `noServer` mode (pure JavaScript, compression off,
  payload limit), no native add-ons.
