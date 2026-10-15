# 157 — CI check failures

Investigate GitHub Actions failure 38755754989 and repair failures on integrated main
without relaxing Chrome 70 production checks. Work in m/ci-check-fixes at
../talos-ng-wt/ci-check-fixes. Preserve concurrent task changes.

Reproduce client typecheck failure, use the Node test runtime's library definitions
only for the test configuration, and run pnpm check. After tasks 154 and 156 finish,
integrate and run pnpm check, pnpm e2e, pnpm e2e:legacy, and pnpm package on main.
Use disk-backed temporary directories and bounded commands. Fix further failures
with focused checks, document evidence in HANDOFF, archive this prompt at completion,
and commit/push main. Observe the resulting GitHub Actions run.
