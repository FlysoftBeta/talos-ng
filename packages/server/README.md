# @talos/server

The Talos II application server (kernel and domain modules). Design: `docs/impl/server.md`,
`docs/impl/modules.md`, `docs/impl/link.md`, `docs/impl/identity.md`; layout and rules:
`docs/impl/structure.md`.

```text
pnpm dev:server    # server only, from TypeScript (data in ./.data, config talos.config.json)
pnpm dev           # real dev server plus Vite
pnpm build && pnpm start   # production client served by the real server
pnpm --filter @talos/server build   # dist/server.js for the pinned Node runtime
```

Deterministic servers for tests: spawn `node --experimental-transform-types
packages/server/bin/talos-server.ts --dev` with `TALOS_DATA_DIR` (fresh absolute directory),
`TALOS_TEST_SEED=true`, `TALOS_BIND_HOST=127.0.0.1`, `TALOS_PORTS=<free port>`; restart with the
same directory and port to keep sessions and queued-operation replay. Seed accounts are in
`src/app/dev-seed.ts`. Environment variables: `docs/impl/server.md`.
