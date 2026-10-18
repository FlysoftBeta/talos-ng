import { cp } from "node:fs/promises";
import { build } from "esbuild";
await build({
  entryPoints: ["bin/talos-server.ts"],
  outfile: "dist/server.js",
  // Packaged as source-maps/server.js.map so the server can restore its own incident stacks.
  sourcemap: "external",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  // Native addons cannot be bundled; releases lay them out in node_modules (tools/package).
  external: ["bufferutil", "utf-8-validate", "better-sqlite3", "sharp"],
  banner: {
    js: 'import { createRequire as __talosCreateRequire } from "node:module"; const require = __talosCreateRequire(import.meta.url);',
  },
});

await cp("stickers", "dist/stickers", { recursive: true });
