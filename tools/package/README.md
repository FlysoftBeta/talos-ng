# Release assembly

`pnpm package` builds `win32-x64`, `linux-debian-x64` and `linux-redhat-x64` installs, update
ZIPs and cloud manifests into ignored `dist/release/` (`update/` holds update ZIPs and cloud manifests, `full/` the installs); `pnpm package -- --target <id>` builds
one. Design, layout and verification: `docs/impl/packaging.md`. Environment:
`TALOS_BUILD_ID`, `TALOS_PACKAGE_TARGET`, `TALOS_RUNTIME_CACHE` (verified Node archive cache,
default `~/.cache/talos-ng/node/`), `TALOS_MEDIA_CACHE` (yt-dlp download cache),
`TALOS_KEEP_E2E=1` (keep the packaged e2e installation).

```text
node --import tsx tools/package/e2e.mjs
node --import tsx tools/package/windows-smoke.mjs [archive-name]
```
