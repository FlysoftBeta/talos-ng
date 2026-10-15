# Chrome 70 compatibility gate

```text
node tools/compat-check/cli.mjs <asset-directory> [--allowlist <file.json>]
```

Exit 0 clean, 1 violations, 2 invalid use. Rules, allow-list format and limits:
`docs/impl/chrome70-compat.md`. Fixtures: `fixtures/good` exits 0, `fixtures/bad` exits 1.
