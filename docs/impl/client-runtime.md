# Client runtime: ports, model / connect / view, navigation, data access

Package `@talos/client`: React 19 + plain CSS (own design system) + Zustand, built by Vite as classic
scripts for Chrome 70 (`chrome70-compat.md`). Directory layout and the enforced import
rules, including the model / connect / view / adapters contract and the "replace list" for a
redesign, are in `structure.md`; this document covers what the runtime does. Entry points:
`packages/client/src/app/runtime.ts` (`createClientRuntime`), `core/runtime-port.ts`,
`app/registry.ts`, `app/areas.tsx`.

## Layers in one paragraph

`core/` is a framework-free runtime (auth, data, files, lifecycle, navigation, status);
`platform/` adapts it to the browser (storage via `@talos/store`, transport via `link`,
React context); `features/` hold product behaviour split into model/connect/view; `ui/` is the
props-in/callbacks-out design system; `app/` composes everything and is the only place that
sees all of it. `dev/` galleries are never in a release.

## Runtime and ports

`createClientRuntime(options)` builds an isolated runtime; `start()` restores IndexedDB before
connecting, `close()` releases network, timers and database. Models never see the runtime
class: they receive narrow capability interfaces from `core/runtime-port.ts`:

| Port | Responsibility |
|---|---|
| `RuntimeCommandPort` | capability checks, typed contract commands, binary RPC, op ids and stamps, retry/discard/flush/sync |
| `RuntimeQueryPort` | runtime and repository subscriptions/snapshots, scopes, outbox, fetched-row admission |
| `RuntimeFilePort` | session-owned bytes, download/retention/collection, local KV |
| `RuntimeNavigationPort` | intents and registration of navigation guards |
| `RuntimeStatusPort` | download/storage reporting, root-only debug-offline control |
| `RuntimeSessionPort` | login/unlock/lock, admission, onboarding, profile/PIN, logout |
| `RuntimeSettingsPort` | setting values, pending/failed marks and updates |
| `RuntimeClockPort` | time and cancellable delays |
| `RuntimeLifecyclePort` | host start/stable-render/close and local reset |

A model declares its dependency as `Pick<...>` of these, takes it in its constructor or
factory, and a controller extends the shared `StateStore` (`core/controller-state.ts`). The
React binding obtains the runtime with `useRuntime` and builds controllers with
`useController` (`platform/react`; legal in connect files, forbidden in models and views).
Facade methods are bound to their controller, so a model can receive single methods. Models
are plain TypeScript tested with fake ports; no DOM is needed.

The runtime shares one session generation and a concealment counter so cancellation is
checked across auth, sync, commands and file reads. Root-only forced-offline diagnostics
(`setDebugOffline`) is runtime-local and resets on reload so a root cannot lock themselves
out; no Web Storage is used anywhere.

## Feature registration

A feature exports `defineClientModule({id, rowTypes, reducers, repositories})` from its
TSX-free `module.ts` (or `model/module.ts`) and `app/registry.ts` lists it; modules never
import each other (the application supplies cross-feature slots, e.g. the reader slot of the
library and the AI/ops panels of the admin workbench, through `app/areas.tsx`). Steps:
pure queued reducers over authoritative rows plus earlier pending intents (they receive
`{user, op}`, never mutate input, replay deterministically), repository selectors read with
`useRepository`, typed commands, and a database migration only if the generic row/KV stores
cannot hold the local data.

## Data access

Features read through **repositories**: in-memory projections hydrated from `@talos/store`,
write-through, subscribed with `useSyncExternalStore`, publishing a stable snapshot until
hydrated. They write through **commands**: `command(contract.method, args, {op?})` validates
arguments and chooses the durable queue or an online call from the contract's `offline` mode
(queued calls return `{queued: op}`). Components never touch IndexedDB or the link client and
never branch on "online": `useCan(method)` returns `{ok:true}` or `{ok:false, reason}` with
consistent Chinese text, and `useGate` checks cached profile roles and features (offline
entitlement is a cached gate). Queued settings reuse one operation id for the LWW value and
its CALL envelope. Sync, outbox and storage details: `sync.md`, `client-store.md`.

## Admission and partial data

Online PIN login, onboarding and resume await server authentication and local session/cache
preparation, then start synchronization in the background. The app can render cached or
empty repositories while the first pull remains unfinished. Online commands are available
once authenticated (`syncing` or `live`); connecting/authenticating still blocks them.
Queued changes remain optimistic and durable, and their sender waits for pull reconciliation.
The activity centre continues showing synchronization progress and recoverable errors; retries
use the engine's backoff. Authentication/admission failures still invalidate credentials.
Every detached completion is fenced by both engine identity and session generation.

Server authentication supplies the admitted roles and features. Cached profile rows cannot
replace them: a profile must have a newer revision than the cache observed at authentication
and come from a completed pull or live delta. Lock/concealment wins over authentication and
background completion never opens a locked gate. Offline PIN admission remains unchanged.

`cacheReady` certifies a previously completed durable cache with valid admitted-scope cursors.
It remains false across a disconnect during initial synchronization, and becomes false if
cache eviction invalidates a cursor. Library and media retention reconciliation waits for
that knowledge and pauses during connecting/syncing, so absent rows cannot delete retained
bytes or document metadata. A complete offline cache still expires retention normally.
Effective synchronized idle-lock changes update the idle timer once; progress notifications
do not continually extend it.

## Navigation

No URL router; the address never changes. Navigation is a serialisable `Nav` value owned by
one reducer: `{area, areas:{[area]: stack}, overlays[]}`, advanced by intents (open
conversation, push page, back, switch area, lock...), validated on restore and persisted per
user in IndexedDB (including overlay stacks, so reopening offline after a PIN unlock returns
to the same area and sheet). `back` closes the top overlay, then pops the area stack, else
does nothing. The browser Back button is trapped with a single same-URL history sentinel and
maps to the lock intent. Lock belongs to the session gate and does not destroy navigation.
Gates are derived state (`boot, deviceLocked, signedOut | onboarding, appLocked, app`), not
routes. Guards registered through the navigation port can intercept intents (a live
practice session guards all exits; concealment still happens immediately).

## Status centre

One state machine and projections (`core/status`): link state, sync progress, last sync,
outbox with retry/discard, downloads, storage estimate and quota exhaustion, build/update.
Pill and centre read a typed `StatusViewModel`; link status is an external store suitable for
`useSyncExternalStore` and never connects or retries on a component's behalf.

## Boot and updates (client side)

`createBoot` runs after the first successful React commit: it confirms an installed build
through IndexedDB before any network operation, then registers the worker and checks for
updates in the background; explicit offline skips network work. When the server refuses this
build at the handshake (`E_VERSION`; the link stays in `versionMismatch`, offline), the shell
installer stages the server's manifest in the background and the 需要更新 dialog offers
现在更新 (finish staging, record the activation request, reload) or 保持离线 (dismiss; the
activity centre keeps a 现在更新 row bound to `versionRejected.updateNow`, which also retries a failed
staging, the status entry shows a dot, and locking applies a ready one). Without a ServiceWorker (plain HTTP) nothing can be staged, so 现在更新 just reloads the page from the server. Boot confirmation happens only after React commits a stable gate. Installer
failures leave the existing app usable. Shell internals: `packaging.md`.

## Design system (`ui/`)

Props in, callbacks out; types only from `@talos/contract`. Tokens, primitives, the frame
and the rules for feature stylesheets are in `design-system.md`. `VirtualScroller` binds
`@talos/virtual` to React. Feature models own sources and commands; the DOM driver owns
measurement and layout. Loaded windows, rendered overscan and viewport intersections are
separate, and source replies and pushes share one ordered stream. Anchoring, end following,
Chrome 70 gesture handling and observer fallback are described in `virtual-scroller.md`.
Icons are inline SVG paths (no icon fonts, remote fonts or third-party requests). Touch
selection is suppressed in the app frame except inputs and `.selectable`; a mounted gesture
guard cancels pinch. A scoped input-modality heuristic restores visible focus on keyboard
use without `:focus-visible`. The gallery (`gallery.html`) is a separate development bundle,
never in the release manifest. Selectors for tests: `docs/impl/e2e-hooks.md`.
