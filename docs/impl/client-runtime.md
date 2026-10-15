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
updates in the background; explicit offline skips network work. When WELCOME announces a
different build, the shell installer stages it in the background and the status centre offers
the update; the user's explicit action records an activation request, and locking applies a
ready update. Boot confirmation happens only after React commits a stable gate. Installer
failures leave the existing app usable. Shell internals: `packaging.md`.

## Design system (`ui/`)

Props in, callbacks out; types only from `@talos/contract`. Tokens, primitives, the frame
and the rules for feature stylesheets are in `design-system.md`. `VirtualListCore` is
DOM-free: Fenwick-indexed heights give O(log n) measurement, offset lookup and seek;
replacing the key set is O(n) and keeps a surviving visible anchor; bottom pinning only
while already at the bottom; the React binding bounds mounted rows independently of
collection size and falls back to manual measurement where ResizeObserver is missing.
Icons are inline SVG paths (no icon fonts, remote fonts or third-party requests). Touch
selection is suppressed in the app frame except inputs and `.selectable`; a mounted gesture
guard cancels pinch. A scoped input-modality heuristic restores visible focus on keyboard
use without `:focus-visible`. The gallery (`gallery.html`) is a separate development bundle,
never in the release manifest. Selectors for tests: `docs/impl/e2e-hooks.md`.
