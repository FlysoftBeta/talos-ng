# Real Chromium 70 harness

`pnpm --filter @talos/legacy-chromium prepare-browser` downloads the official Linux x64
snapshot 587811 (Chromium 70.0.3538.0) into `~/.cache/talos-ng/chromium/587811/`, checks the
archive checksum and the executable version, using JavaScript only (no curl/unzip/tar).
`launchChrome(executable)` starts it with an isolated profile and exposes a raw-CDP client.
Use it only with local test content. Context: `docs/impl/chrome70-compat.md`; run through
`pnpm e2e:legacy`.
