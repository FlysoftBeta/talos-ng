import tseslint from "typescript-eslint";
import { boundaryPlugin } from "./tools/boundaries.mjs";
import { boundaryFiles } from "./tools/boundaries/coverage.mjs";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "tools/compat-check/fixtures/**",
    ],
  },
  tseslint.configs.recommended,
  { files: ["**/*.{ts,tsx,mjs}"], rules: { "no-console": "error" } },
  {
    files: boundaryFiles,
    plugins: { boundaries: boundaryPlugin },
    rules: { "boundaries/imports": "error" },
  },
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportDefaultDeclaration",
          message: "Use named exports in library packages.",
        },
        {
          selector:
            'ExportNamedDeclaration > ExportSpecifier[exported.name="default"]',
          message: "Use named exports in library packages.",
        },
      ],
    },
  },
  {
    files: ["packages/*/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["packages/{client,server,launcher}/**/*.{ts,tsx}"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["packages/{store,shell}/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { globals: ["Blob", "File"], checkGlobalObject: true },
      ],
      "@typescript-eslint/no-restricted-types": [
        "error",
        {
          types: {
            Blob: "Use ArrayBuffer or strings in storage.",
            File: "Use ArrayBuffer or strings in storage.",
          },
        },
      ],
    },
  },
  {
    files: [
      "tools/**/*.{ts,tsx,mjs,js}",
      "**/*.test.{ts,tsx,mjs,js}",
      "**/tests/**/*.{ts,tsx,mjs,js}",
    ],
    rules: { "no-console": "off" },
  },
);
