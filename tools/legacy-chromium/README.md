# Real old Chromium harness

`pnpm --filter @talos/legacy-chromium prepare-browser [70|80]` downloads an official Linux x64
snapshot into `~/.cache/talos-ng/chromium/<revision>/`: 587811 (Chromium 70.0.3538.0, the
oldest client) or 722269 (Chromium 80.0.3987.0, the first one sent to HTTPS). It checks the
archive checksum and the executable version, using JavaScript only (no curl/unzip/tar).
`launchChrome(executable, args)` starts it with an isolated profile, a UTF-8 locale and no
proxy variables, and exposes a raw-CDP client.
Use it only with local test content. Context: `docs/impl/chrome70-compat.md`; run through
`pnpm e2e:legacy` (Chromium 70) or `pnpm e2e:chrome80`.
