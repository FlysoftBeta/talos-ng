// Files the boundary plugin runs on (B1): package sources, bin entries, build
// scripts and configs, and every tool. Shared by eslint.config.mjs and ratchet.mjs.
export const boundaryFiles = [
  "packages/*/**/*.{ts,tsx,mjs}",
  "tools/**/*.{ts,tsx,mjs}",
];
export const boundaryIgnores = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "tools/compat-check/fixtures/**",
];
