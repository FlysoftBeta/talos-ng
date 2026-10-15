# CI repair evidence

- GitHub run 38755754989 failed in client test typechecking: 20 TS2550 errors
  for Array.at, because tsconfig.test.json replaced the Node ES2023 library with ES2018.
- Local client typecheck reproduced the errors. Set only the test library to ES2023;
  the production tsconfig still checks ES2018 first.
- GitHub run 38753096704 also reported a five-second timeout in IntervalSet's 8,000-step
  seeded model test. Compare each iteration's gap membership arrays in one assertion,
  retaining every operation, membership probe and invariant check.
- Focused IntervalSet run: 16 passed. Full pnpm check in the isolated worktree:
  174 files passed, 1,747 tests passed, one skipped; build compatibility: zero violations.
- Task 154 independently fixed the same test library using ES2022. Retain that
  minimal library on integration; final main browser/package gates remain pending.
