import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Same project definition the root config generates for packages without their own config,
// plus a longer default time budget. Almost every server test boots a real kernel (schema
// migrations, credential hashing, catalogue seeding) and the suite runs in parallel
// workers; under load a boot alone takes several seconds (`startServer` measured at 3.5 s
// idle and 11 s under the full parallel run), so vitest's 5 s default made correct tests
// flaky. Timing is not asserted anywhere: this is purely a failure-detection ceiling.
export default defineConfig({
  test: {
    name: "@talos/server",
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "node",
    include: ["**/*.test.{ts,tsx,mjs}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // expect.poll defaults to 1 s; background jobs under load need longer (it returns as soon as true).
    expect: { poll: { timeout: 20_000 } },
  },
});
