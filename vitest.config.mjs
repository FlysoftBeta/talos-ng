import { readdirSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const projects = ["packages", "tools"].flatMap((parent) =>
  readdirSync(path.join(root, parent), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(path.join(root, parent, entry.name, "package.json")),
    )
    .map((entry) => {
      const directory = path.join(root, parent, entry.name);
      const config = ["ts", "mts", "js", "mjs"]
        .map((ext) => path.join(directory, `vitest.config.${ext}`))
        .find(existsSync);
      if (config) return config;
      const { name } = JSON.parse(
        readFileSync(path.join(directory, "package.json"), "utf8"),
      );
      return {
        test: {
          name,
          root: directory,
          environment: "node",
          include: ["**/*.test.{ts,tsx,mjs}"],
          exclude: ["**/node_modules/**", "**/dist/**"],
        },
      };
    }),
);
export default defineConfig({
  test: {
    projects,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "tools/compat-check/*.mjs"],
      exclude: ["**/*.test.*", "**/*.d.ts"],
    },
  },
});
