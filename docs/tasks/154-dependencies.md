# 154 — Update all dependencies and restore yt-dlp default client

User asks: 更新所有依赖，包括 yt-dlp，并把 yt-dlp 的 client 置为默认.
Update all workspace dependency manifests and lockfile to latest available stable releases, including toolchain/package manager and pinned downloaded runtimes/helpers where appropriate. Verify actual published versions from authoritative registries/releases (do not invent versions). Preserve Chrome 70, platform packaging, existing TypeScript compiler roles and native platform constraints; explain any necessary retained versions. Update yt-dlp release URLs and SHA256 from official release assets; remove forced youtube player_client so upstream defaults apply. Inspect tests and update meaningful assertions for default client behavior. Review native manifest, packaging runtime pins and vendored helper scope explicitly.

Authorized scope: all dependency manifests, lockfile, tools, affected code/tests, implementation documentation. Avoid unrelated changes. Read repository instructions. Use disk-backed .tmp for all gates. Run pnpm install, pnpm check and focused media tests; fix regressions. Commit each coherent step. Do not merge/push or edit HANDOFF/ROADMAP/DECISIONS. Write docs/tasks/154-dependencies.result.md with versions, retained pins/reasons, verification evidence and outstanding limitations, then commit it. Orchestrator will run full gates on main. No further agents needed. Wall clock limit 60 minutes.

## Resume instruction (supersedes verification requirements above)

2026-10-15: user explicitly instructed “不需要跑测试，能构建即可”. Run only
`pnpm build` and format changed files as needed; do not run tests, check, e2e,
package smoke or test typechecks. Remove the newly added untracked provider test,
retain production changes, finish published-version/helper/runtime-pin review,
and document exact build evidence and retained pins/reasons. Do not edit
HANDOFF/ROADMAP/DECISIONS. Commit on `m/dependencies`; no merge/push. Resumed job
wall-clock limit: 30 minutes. Tests are deliberately skipped.
