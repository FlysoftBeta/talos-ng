# Production browser verification

```sh
pnpm --filter @talos/e2e exec playwright install chromium   # once
pnpm e2e              # build shell + client, run every feature on current Chromium
pnpm e2e:legacy       # same on the real Chromium 70 (raw CDP)
pnpm e2e:chrome80     # same on the real Chromium 80 (raw CDP)
node --import tsx tools/e2e/run.mjs <feature ...> [--legacy | --chrome80]   # build first
```

Features run in this order: `identity`, `library`, `netbooks`, `media`, `chat`, `admin`,
`ai`, `hardening`, `virtual`, `ops`, `offline`, `pdf`. Aliases: `learning` -> `identity`, `reader` ->
`library`, `update` -> `offline`. Every feature gets its own server (the real server CLI on
a free localhost port with a temporary database and a copy of the production client, or the
static gallery server) and a fresh browser, so no storage, ServiceWorker, emulation or
virtual-time state leaks between features. Processes, profiles and temp dirs are cleaned up
on failure too. The harness's start message (`dev` and `testSeed`) seeds root PIN `123456` and ordinary PIN
`654321`; these exist only in the explicitly enabled development fixture.

The `pdf` feature starts the real server with HTTPS and the operator redirect for the LAN
name `talos.test` (a throwaway `openssl` certificate; every browser maps the name to
127.0.0.1 and accepts the certificate). The browser opens the plain HTTP address as a tablet
does, so Chromium 80+ is redirected to HTTPS with a ServiceWorker while Chromium 70 stays on
insecure HTTP. It covers page rendering, a 500-page pack, a page image above the link limit
read by HTTP ranges, retention into IndexedDB and reading from storage offline.

## Layout

A feature is `scenarios/<feature>/index.mjs` exporting `{ name, server: "real" | "static",
prepare?, run(ctx, server), after? }`. `harness/` holds the shared machinery (browser
abstraction over current Chromium and raw-CDP Chromium 70, real and static servers, waits, UI
helpers, a binary link client for seeding); harness unit tests (`*.test.mjs`) run in
`pnpm check`.

## Selectors

Scenarios locate elements only by `data-testid` hooks (`<area>.<thing>[.<part>]`) and by ARIA
roles/accessible names; never by class name or DOM shape. The contract the UI must keep is
`docs/impl/e2e-hooks.md`.

## Waits and stability

Every condition wait returns the moment its condition holds; `WAIT_TIMEOUT` (45 s) is only
the failure ceiling and is shared by both engines, `eventually`, the link client and server
boot (`TALOS_E2E_STARTUP_TIMEOUT_MS`, default 120 s). Navigation inside the admin workbench
uses `openSection`, which waits for the section to be `aria-current=page` and repeats the
click only when that registration did not appear. Long AI generations that must still be
running after a reconnect use the test provider's endless `持续生成` prompt instead of racing
a finite answer. `TALOS_E2E_CPU_THROTTLE=6` slows page CPU to expose timing assumptions.

## Artifacts

Screenshots (`{current,chrome70}-...png`) and the hardening measurements are a debugging
artifact only: written under the git-ignored `.tmp/e2e/` (`TALOS_E2E_OUTPUT_DIR` to move
it). Nothing is compared or tracked. Captures still assert there is no horizontal page
overflow. On shared hosts point `TMPDIR` at a disk directory.

The `virtual` bench checks id anchoring, asynchronous paging, per-frame size changes,
wheel/touch scrolling, end following and viewport coverage, including the no-ResizeObserver
fallback. Its native input reference is independent of scroller geometry. See
`docs/impl/virtual-scroller.md` for the state-machine/model testing counterpart.
