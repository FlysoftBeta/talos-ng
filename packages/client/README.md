# @talos/client

The Talos II React application (Chrome 70 target). Architecture and mechanisms:
`docs/impl/client-runtime.md`, `docs/impl/client-features.md`, `docs/impl/structure.md`.

```sh
pnpm dev                        # real server + Vite dev server (never registers a ServiceWorker)
pnpm --filter @talos/client build
node tools/compat-check/cli.mjs packages/client/dist
pnpm e2e && pnpm e2e:legacy     # production build on current Chromium and real Chromium 70
```

`/gallery.html` (development only) shows the design system with fixtures: `?theme=dark`,
`?grid` (100,000-row grid), `?auth=login|wrong-pin|throttled|offline-unavailable|lock|device-locked`,
`?ops=update|backup|https|host|office` (`&offline=1`). Production output is
`dist/index.html` plus hashed classic scripts under `dist/app/<build>/` and
`dist/app/manifest.json`; `TALOS_BUILD_ID` overrides the build id (git short hash plus
`-dirty`). Serve `packages/shell/dist/sw.js` as `/sw.js` on HTTPS or localhost.
