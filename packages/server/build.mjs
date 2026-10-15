import { cp } from "node:fs/promises";
import { build } from "esbuild";
await build({
  entryPoints: ["bin/talos-server.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["bufferutil", "utf-8-validate"],
  banner: {
    js: 'import { createRequire as __talosCreateRequire } from "node:module"; const require = __talosCreateRequire(import.meta.url);',
  },
});

await cp("src/modules/chat/assets", "dist/chat-assets", { recursive: true });
