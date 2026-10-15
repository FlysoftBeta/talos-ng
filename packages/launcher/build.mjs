import { build } from "esbuild";
await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/launcher.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
});
