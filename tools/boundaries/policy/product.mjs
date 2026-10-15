// Applies to every packages/* file.
const testSupport = [
  "**/testing.{ts,tsx}",
  "**/testing/**",
  "**/test-fixtures.ts",
  "**/*.fixture.*",
  "**/fixtures/**",
  "**/http-fixtures/**",
];
export default {
  layers: [
    {
      id: "product-no-tools",
      from: ["src/**", "bin/**"],
      forbid: ["tools/**"],
      reason: "Product code never imports repository tooling.",
    },
    {
      id: "product-no-test-support",
      from: ["src/**", "bin/**"],
      fromIgnore: testSupport,
      skipTests: true,
      forbid: testSupport,
      reason:
        "Product code never imports testing helpers or fixtures; only test files and other test-support files may.",
    },
  ],
};
