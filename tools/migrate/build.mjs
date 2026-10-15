import { build } from "esbuild";
await build({
  entryPoints: ["bin/release.ts"],
  outfile: "dist/migrate.js",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // Native addons cannot be bundled; releases lay them out in node_modules (tools/package).
  external: ["bufferutil", "utf-8-validate", "better-sqlite3", "sharp"],
  banner: {
    // The node:sqlite warning is filtered in bin/release.ts.
    js: 'import { createRequire as __talosCreateRequire } from "node:module"; const require = __talosCreateRequire(import.meta.url);',
  },
});
