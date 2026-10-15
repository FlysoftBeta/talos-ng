# Identity, devices and authority

Server modules `identity` and `authority`, contract `auth`/`identity`/`authority` methods,
client `core/auth` and the auth feature. Entry points:
`packages/server/src/modules/identity/index.ts`, `modules/authority/index.ts`,
`packages/client/src/core/auth/controller.ts`.

## Credentials

- Users and device ids are ULIDs. The credential is a six-digit PIN, **globally unique** across
  users and live invitations, so there is no account-id field at login.
- A user has one or two PINs; the second is an equivalent credential for the same account
  (not a confirmation, second factor or duress code). Replacing PINs replaces the whole set,
  requires either current PIN, keeps the current device's session and revokes the others.
- **Verification and lookup are both memory-hard.** Each PIN has an independent random
  128-bit salt and a 256-bit scrypt verifier; the global uniqueness lookup is also scrypt,
  salted with a generated per-database secret. A fast keyed index stored next to the
  verifiers would let an offline attacker skip slow verification. Missing PINs run the same
  two derivations so timing does not reveal existence. Wire-path derivations are asynchronous
  and limited to two concurrent; bootstrap and in-process fixtures have synchronous variants.
  Older HMAC-indexed rows stay usable and upgrade to scrypt on successful login (with an atomic
  recheck so an in-flight upgrade cannot resurrect a replaced PIN).
- Sessions are random 32-byte tokens stored hashed, with a 24-hour sliding lifetime. A device
  holds at most two live accounts for fast switching; a third login is rejected until one
  logs out or expires. One session binds to a connection; lock detaches the connection but
  keeps its saved token resumable, logout revokes the token and outstanding download tickets.
  Logout also works when device admission was subsequently denied (the supplied token must
  belong to the current device).
- First boot creates the root account and prints its PIN once to the console, after the
  transaction commits; the file log redacts it even across fragmented pipe chunks.
- **Credential version.** PIN replacement increments a monotonic per-user version (atomically
  with the PIN set), returned in session replies, replacement replies and the synced
  profile. A client may keep locally derived offline verifiers across online unlock only
  while account and version still match; a newer version clears them (in other tabs too) and
  older cached profiles can never lower it.

## Invitations and onboarding

Invitations are one-use PINs valid seven days, sharing the PIN namespace with users. Logging
in with one issues a 15-minute random onboarding token bound to that device (a later login
replaces it). Redemption re-validates after the KDF work; profile, PIN, session and
invitation changes commit together. A device that is already bound cannot onboard. Handles
are 1-20 ASCII letters/digits/underscores, display names 1-30 characters.

## Device admission and throttling

- A device is a stable browser id stored in IndexedDB and registered with the server (not
  MAC/IP/user-agent matching, which could merge unrelated devices and needs host commands).
  Clearing browser storage creates a new device that is subject to admission policy again.
  Administrators may additionally require hashed User-Agent and/or IP signals: the server
  stores SHA-256 hashes and rejects a changed selected signal on login or resume; a missing
  signal on a local transport is ignored; existing devices enrol a newly selected signal at
  their next authenticated attempt.
- Policy produces an exact `data.reason`: `whitelist-required`, `bound-to-other-user`,
  `banned`, `throttled` (with `retryAt`), `invalid-client`, `system-lock`, `idle-lock`.
  Whitelist, binding and ban rules revalidate live connections on every call and fan-out.
  The five-minute idle policy lets a fresh correct PIN recover while cached-token restore
  stays locked; administrators are exempt from system and idle locks.
- Throttling: the fifth wrong attempt blocks a device for 15 minutes; the twentieth blocks the
  source IP for the same time (larger budget for shared school NAT). The IP comes only from
  the server's socket address, never forwarded headers or arguments; a success clears the
  device counter but cannot erase the IP budget.
- Current-device safety: the administrator's own device is added to the whitelist before
  whitelist mode turns on, and cannot be locked, deleted or de-whitelisted by its own session.
- Bans are a permanent flag plus an optional epoch-millisecond deadline owned by identity;
  admission, authority checks and projections evaluate the injected clock (also after a
  restart). Bulk enable preserves an active deadline; unban clears it. Banning revokes
  sessions and sends a live revoked event to the target browser.

## Authority

- `AuthorityService.can(actor, action, resource)` is **the only policy entry point**; actor
  records are re-read on every decision. Resources supply canonical id, optional owner and
  required feature.
- Eight specialist admin roles form a hierarchy with dependencies; ordinary users
  have none. The last effective root cannot be removed. Root manages roles, gates and
  invitations; access managers may invite; feature managers edit gates.
- **No administrator or root bypass for resources**: reading a document, collection,
  playlist or conversation needs ownership, membership or an explicit read/write/own grant;
  feature gates are not implied by a role. Only owners (or delegable paths) can delegate.
  Reader, ebook reader and article-download gates additionally require `articles`
  (shared `hasFeature`). Preferences carry no authority: roles and gates live only in the
  identity/authority tables.
- `authority_access` stores role/gate overrides; `authority_grants` stores grants and
  revocation tombstones. Access changes update the `profile` row in `me:<user>`; grants sync
  as `grant` rows to their user/group principals. Server `can` always reads current
  membership; clients only need refreshed scopes, so a membership change re-projects the
  affected users' grants (and, for leaving a group, withdraws inherited grants).
- Ops RPCs call `can` with action-specific vocabulary: settings, host tools and updates need
  root; backup, HTTPS status and Office capture accept administrators. The client uses the
  same vocabulary (`useGate`, `useCan`).

## Client side

- **Online PIN login stores a random 128-bit salt and a 210,000-iteration PBKDF2-SHA256
  verifier (WebCrypto), never the PIN.** Offline unlock uses it with persisted attempt
  throttling and cannot authenticate an account never logged in on this device. Without
  WebCrypto (insecure intranet origin) online login still works and offline unlock is off;
  there is no weak-hash fallback. Server rejection of a resume or admission removes the local
  verifier; a denied session keeps only a revoke-only token so online logout can still
  revoke it, and that token cannot unlock cached data.
- A restart restores the locked state. Lock from the rail, history trap or idle timer
  conceals the frame synchronously and does **not** call `auth.lock` (which would unbind
  sync); the concealment gate keeps session and sync alive. A late login or resume cannot
  override a newer concealment intent. Every engine callback is fenced to its owning session
  so stale failures cannot clear a newer login.
- Concealment: the exact unlock direction sequence, touch zones and 700 ms synthetic-mouse
  suppression (browser Back uses a single same-URL history sentinel, still concealing at
  once). Escape on required dialogs closes to the lock screen without completing the workflow.
- Logout needs the server and deletes the offline verifier only after acknowledgement,
  keeping cached rows and queued changes. Reset closes the runtime, notifies other tabs,
  rebuilds only `talos-app` and reloads (see `client-store.md`).
- Do-not-disturb, theme, text size and idle lock are queued LWW settings; profile, PIN changes,
  invitations and logout are online-only.
