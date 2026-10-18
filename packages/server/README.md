# @talos/server

The Talos II application server (kernel and domain modules). Design: `docs/impl/server.md`,
`docs/impl/modules.md`, `docs/impl/link.md`, `docs/impl/identity.md`; layout and rules:
`docs/impl/structure.md`.

```text
pnpm dev:server    # server only, from TypeScript (config dev-config/, writes to dev-data/)
pnpm dev           # real dev server plus Vite
pnpm build && pnpm start   # production client served by the real server
pnpm --filter @talos/server build   # dist/server.js for the pinned Node runtime
```

Deterministic servers for tests: fork `packages/server/bin/testing/server.ts` with `execArgv:
["--import", "tsx"]` and an IPC channel, write a `config/config.json` with the free port,
`bindHost` and fresh absolute `dataDir`/`logsDir`/`tmpDir`, and send the start message
(`sendStart` from `@talos/launcher`) with that `configDir`, `dev: true` and `testSeed: true` (see `tools/e2e/harness/real-server.mjs`); restart with
the same directory and port to keep sessions and queued-operation replay. Seed accounts are in
`src/app/dev-seed.ts`. Configuration: `docs/impl/server.md`.
