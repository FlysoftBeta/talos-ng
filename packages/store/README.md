# @talos/store

IndexedDB engine, KV and resumable content-addressed `FileStore` for Chrome 70+. Design and
rules (no Blob values, transaction-callback restrictions, leases, GC): `docs/impl/client-store.md`.

```text
pnpm --filter @talos/store test                 # fake-indexeddb
pnpm --filter @talos/store test:browser:install # once
pnpm --filter @talos/store test:browser         # same tests in real Chromium + two-tab check
```

`@talos/store/testing` exports `createTestEnvironment()`: a fresh fake IndexedDB per call for
consumers' tests.
