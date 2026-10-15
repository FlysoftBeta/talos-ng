import { build } from "esbuild";
await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/launcher.js",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
});
