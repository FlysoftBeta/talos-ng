# 154 — Dependency update result

Completed on `m/dependencies`, 2026-10-15. No merge or push. HANDOFF, ROADMAP and
DECISIONS were not edited.

## Latest instruction and verification scope

The resumed user instruction, “不需要跑测试，能构建即可”, supersedes the original
prompt's test/gate requirements. Tests were deliberately skipped. No check, e2e,
package assembly/smoke, standalone typecheck or test typecheck was run in this
resumed job. The newly added untracked media `provider.test.ts` was removed;
production changes were retained. The interrupted job's `.tmp/154-check.log` is
historical evidence of an interrupted check, not a passing gate for this result.

## Published versions

Re-fetched npm registry metadata for every external workspace dependency and pnpm
at 2026-10-15T14:34:22.920Z from `https://registry.npmjs.org/<package>`.
`latest` stable tags were used; canary, next, beta and RC tags were excluded.
Full local metadata: `.tmp/154-versions-verified.json` (ignored scratch).

| Dependency                  | Previous manifest                          | Final version     |
| --------------------------- | ------------------------------------------ | ----------------- |
| react, react-dom            | 19.3.0                                     | 19.3.1            |
| katex                       | 0.16.22                                    | 0.19.0            |
| markdown-it                 | 14.1.0                                     | 15.0.2            |
| cheerio                     | 1.0.0                                      | 1.2.0             |
| ws                          | 8.18.3                                     | 8.22.0            |
| @types/ws                   | 8.18.1                                     | 8.18.2            |
| fflate                      | 0.8.2 in docpack/migrate; ^0.8.3 in client | 0.8.3 everywhere  |
| esbuild                     | 0.25.12 / ^0.25.0                          | 0.28.2 everywhere |
| tsx                         | 4.20.6                                     | 4.23.15           |
| vitest, @vitest/coverage-v8 | 5.0.4                                      | 5.0.5             |
| jsdom                       | 30.1.2                                     | 30.1.3            |
| playwright                  | 1.64.0 / ^1.56.0                           | 1.64.1 everywhere |
| fake-indexeddb              | 6.2.5 / ^6.2.4                             | 6.2.5 everywhere  |
| @types/better-sqlite3       | ^9.6.0                                     | 9.6.0             |

Removed `@types/katex` and `@types/markdown-it`: the new runtime packages ship
and export their own declarations (`types/katex.d.ts` and `dist/markdown-it.d.mts`
/ `.d.cts`). Their registry latest versions were also reviewed (0.16.8 and 14.2.0);
keeping declarations for the previous runtime APIs would be redundant.

Already at registry latest, retained unchanged: pnpm 12.11.2, core-js 3.50.0,
zustand 5.0.15, better-sqlite3 13.0.3, sharp 0.35.5, @types/react 19.3.0,
@types/react-dom 19.3.0, vite 8.3.4, eslint 10.12.0,
typescript-eslint 8.71.2, prettier 3.9.10, acorn 8.19.0, extract-zip 2.0.1.

Direct dependency ranges were made exact and the pnpm lockfile retained from the
successful prior install was reviewed against the manifests. The prior
`.tmp/154-install.log` records exit 0, pnpm 12.11.2, 20 workspace projects, and
340 lockfile entries passing pnpm supply-chain policy. No install was rerun in the
resumed build-only job. Narrow, version-specific minimum-release-age exceptions
were updated for the selected newly published packages; no blanket bypass was
introduced.

## Retained compatibility pins

| Pin                                                                           | Published alternative                                                  | Reason retained                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| zod 3.25.76                                                                   | latest 4.6.7; 3.25.76 is latest stable 3.x                             | Contract schemas and the Chrome 70 build use Zod 3. The client purity annotation explicitly matches `zod/v3/types.js` to eliminate unused native BigInt code. Moving to Zod 4 needs a separate API/browser compatibility migration.                                                                                                                    |
| `typescript` alias to `@typescript/typescript6@6.0.2`                         | This package is at its own latest; ordinary typescript latest is 7.0.2 | TypeScript 6 supplies the JS compiler API consumed by ESLint tooling. Preserve that role rather than replacing it with the separate compiler implementation.                                                                                                                                                                                           |
| `typescript7` alias to `typescript@7.0.2`                                     | At latest                                                              | `tools/typecheck.mjs` intentionally invokes this compiler separately. No compiler role was changed.                                                                                                                                                                                                                                                    |
| @types/node 22.20.5                                                           | latest 26.6.5; 22.20.5 is latest stable 22.x                           | Keep declarations at the supported Node 22 baseline; Node 26 types could permit APIs absent on that baseline. Server/launcher/migration bundle targets remain node22.                                                                                                                                                                                  |
| Chromium snapshot 587811, MD5 8e05eb3d6598904b7fb8a7758b758132                | Modern Chromium                                                        | This is the deliberately fixed Chrome 70 compatibility fixture, not a deployment browser to upgrade. No browser was downloaded or executed.                                                                                                                                                                                                            |
| pdfrender commit ae0a0dad5da9aec296bb99c401f8930b48695272, CI run 31309289423 | No published release identified                                        | Official releases page returned HTTP 200 and “There aren’t any releases here”. Preserve the three vendored platform payloads, archive digests, runtime DLLs, Poppler data and provenance together; a source rebuild/format migration is separate work. The earlier API request was rate-limited; no claim that the latest source/workflow was audited. |

The root development Node engine is now `^22.22.2 || ^24.15.0 || >=26.0.0`,
matching the supported jsdom 30.1.3 engine branches (and excluding unsupported
odd majors under 26). This describes the workspace toolchain; bundled production
Node is selected separately.

## Runtime, native helpers and CI

- Bundled Node and both CI Node selections: 22.23.3 → **26.12.0**. The official
  [release index](https://nodejs.org/dist/index.json) identifies 26.12.0 as the
  latest stable Current release, not LTS (latest LTS observed: 24.22.0). This follows
  the request for latest stable. The official
  [SHASUMS256.txt](https://nodejs.org/dist/v26.12.0/SHASUMS256.txt) was fetched and
  contains both required assets:
  - linux-x64.tar.gz: `d9f88af72ad34f7ddf8e67289829f1698f54b6254f7d4f54b7453117ff1a3d2c`
  - win-x64.zip: `50efaf01a08c520b4bbe499c09a8c5a5c370002c419c0d9da2c6815d3066a453`
    Existing package-time download/hash verification is retained. The new Node
    archives were not downloaded/executed in this build-only job.
- yt-dlp: 2026.07.04 → **2026.08.19**, verified by the official
  [latest-release redirect](https://github.com/yt-dlp/yt-dlp/releases/latest).
  Both manifest hashes match the official
  [SHA2-256SUMS](https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/SHA2-256SUMS):
  - yt-dlp_linux: `58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a`
  - yt-dlp_win.zip: `30b4c14aafab6082becff7881e41b76df46dc43ea7633479410a91e29da492bf`
    The Windows ZIP layout and Linux executable selection are unchanged. No
    yt-dlp binary download/execution or live provider request was performed.
- Native manifest: unchanged deliberately because better-sqlite3 and sharp are
  already latest. Independently computed SHA-256 of all **seven** installed
  Linux/Windows files listed in `tools/package/native-manifest.json`; every hash
  matches. Includes both better-sqlite3 prebuilds, both sharp addons, Linux
  libvips 8.18.7, and the two Windows libvips DLLs. Existing packaging code uses
  N-API prebuilds, but native loading under Node 26 and all release targets remain
  unverified. No binary was committed.
- No independent FFmpeg or Deno download pin exists in the packaging path; no new
  helper/runtime was added. Existing bundled Node remains the only separately
  packaged JavaScript runtime. Upstream yt-dlp client/runtime behavior was not
  exercised.
- CI actions updated from v4 selectors to exact latest release tags, verified by
  each official `releases/latest` redirect and the tagged `action.yml`:
  checkout **v7.0.1**, setup-node **v7.1.0**, cache **v6.1.0**,
  upload-artifact **v7.0.2**, download-artifact **v8.0.2**,
  pnpm/action-setup **v6.1.0**. Tagged metadata uses Node 24 and preserves the
  workflow's used inputs, including cache, artifact merge, compression and pnpm
  packageManager lookup. pnpm action caching remains off by default; setup-node
  continues handling the pnpm cache. Hosted ubuntu-24.04 remains selected.
  Workflow execution was deliberately not triggered.

## Production behavior

`YtDlpProvider` now invokes `["--no-warnings", ...args]`, removing the forced
`--extractor-args youtube:player_client=web_music` for search, resolution and
materialisation alike. yt-dlp chooses its upstream player-client defaults.
Timeout, cancellation, output limits, audio format and error handling are
unchanged. Implementation docs describe the default and bundled Node update.

## Exact build evidence

Local environment: Node **v22.23.1**, pnpm **12.11.2**, Linux x64.

The literal unmodified workspace build embeds validation: several packages have
`build = pnpm typecheck`, some combine it with emission, and contract also runs
`compat.mjs` (a fixture-based runtime test). To obey the no-test instruction,
a temporary scratch wrapper backed up those manifests, removed only the
`pnpm typecheck` and `node compat.mjs` build steps, invoked **`pnpm build`**, and
restored every manifest byte-for-byte in `finally`. Validation-only builds
printed a skip message. No script changes from this wrapper are committed.

Command: `timeout 900 node .tmp/154-build-only.mjs > .tmp/154-build.log 2>&1`.
The wrapper sets `TMPDIR`, `TALOS_LARGE_TEST_TMPDIR` and
`TALOS_PACKAGE_E2E_TMPDIR` to this worktree's disk-backed `.tmp`.

- Start: **2026-10-15T14:34:29.632Z**.
- End: **2026-10-15T14:34:32.871Z**.
- Duration: **3.239 seconds**.
- Exit: **0**.
- Emitted shell, store, launcher, server, migration and client bundles.
- Client Vite 8.3.4 built all four entries: polyfills, main, gallery, ai-renderer.
- Existing build-time static output scans reported shell **1**, store **1**,
  client **10** JS/CSS/HTML files, each with **0 compatibility violations**.
- Client release-output validation completed as part of its existing build.
- Original build scripts restored; therefore this evidence is for build emission
  with validation steps deliberately omitted, not an unmodified full gate pass.

Ignored local evidence: `.tmp/154-build.log`, `.tmp/154-build-evidence.json`,
`.tmp/154-build-only.mjs` and `.tmp/154-build-manifest-backup.json`.

No unit tests, test typechecks, runtime compatibility fixtures, browser/e2e,
package smoke or full gates were run in this resumed job, per latest instruction.
Functional behavior, native Node 26 execution, native Windows/Linux deployment,
new CI actions and real Chrome 70 rendering remain unverified. Build success and
static compatibility scans do not establish those runtime outcomes.
