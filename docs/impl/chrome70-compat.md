# Chrome 70 compatibility

The client floor is Chrome 70 (managed tablets run 70-80). Verification is layered because
no static check proves behaviour: the build gate, runtime guards, and tests on a real
Chromium 70 binary. Entry points: `tools/compat-check/cli.mjs`, `packages/client/vite.config.ts`,
`tools/legacy-chromium`, `tools/e2e`.

## Language and API floor

- TypeScript `lib` is ES2018 + DOM for the client; isomorphic and shell packages typecheck
  with ES2018 and no DOM or Node types. Newer built-ins are either avoided or polyfilled
  explicitly. Unsupported syntax includes optional chaining, nullish coalescing, BigInt
  literals, `import.meta`, top-level await and optional catch bindings.
- Build targets are `chrome70` and `es2018` together (Chrome 70 alone would allow optional
  catch bindings, which the checker rejects). The client emits standalone classic scripts
  (IIFEs): no dynamic module loader, import maps or Vite runtime in the release. CSS also
  targets Chrome 70.
- Polyfills are an explicit `core-js` subset loaded by ordered `defer` scripts before the
  application: `es.global-this`, `web.queue-microtask`, `es.object.from-entries`,
  `es.promise.all-settled`. No blanket core-js import, custom elements or WebAssembly.
  `ResizeObserver` is feature-detected with a manual fallback. The build emits
  `compat-allowlist.json` with the exact hashed files and a justification per polyfilled API.
- CSS: no flex/grid `gap`, `inset`, `aspect-ratio`, `clamp()/min()/max()`, `:is/:where`,
  `:focus-visible`, `backdrop-filter`. Authored CSS is linted and an Emotion/stylis guard
  rejects such declarations at runtime, development included; `Stack`/`Inline` and MUI
  overrides in `ui/` provide the margin-based fallbacks.
- No remote fonts; typography is the system CJK stack. Pinned Zod 3's unused `ZodBigInt`
  declaration is annotated as pure by the bundler transform (which fails if the declaration
  shape changes), so contract validation stays unchanged and a real bigint schema fails the gate.

## The compatibility gate

`node tools/compat-check/cli.mjs <asset-dir> [--allowlist file.json]` parses every `.js`
file (and inline scripts) with Acorn as ES2018, and scans JS and CSS with maintained rules.
Newer syntax fails parsing; API heuristics cover `globalThis`, `queueMicrotask`,
`allSettled`, `fromEntries`, `flat/flatMap`, observer constructors without a `typeof`
guard, `matchAll`, `replaceAll`, `at`, `structuredClone`, BigInt (token-aware, so the word in
strings and comments is not a hit). Exit 0 clean, 1 violations, 2 invalid use. An allow-list
(by default `<dir>/compat-allowlist.json`) can excuse specific **JS API** hits with a
justification; syntax and CSS violations can never be excused, wildcards do not exist. The
checker is conservative text heuristics: it cannot prove a polyfill loads first and can miss
aliased access, so it is a build gate, not a substitute for running Chrome 70. Client
`dist` (including lazy AI assets) and the shell worker run it in their builds; release
packaging copies only manifest assets.

## Real-browser verification

`tools/legacy-chromium` downloads the official Chromium 70.0.3538.0 snapshot (revision
587811) with a checksum, verifies the executable version, and drives it over raw CDP (Node's
native WebSocket; Playwright is not used). The same production UI scenarios (`tools/e2e`)
run on current Chromium (Playwright) and on this binary, including ServiceWorker boot,
IndexedDB, offline restart and update. The legacy binary is Linux x64 only; other hosts use the
current-browser suite. Wine runs of the Windows package are not a native Windows qualification.
