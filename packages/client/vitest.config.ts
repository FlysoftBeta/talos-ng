import { defineProject } from "vitest/config";
export default defineProject({
  test: {
    name: "@talos/client",
    root: import.meta.dirname,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "scripts/*.test.mjs"],
    // jsdom suites and the seeded 10 000-intent reducer run exceed vitest's 5 s
    // default when the whole workspace (or coverage) loads the machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
