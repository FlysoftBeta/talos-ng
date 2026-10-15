import { defineConfig } from "vite";
// Dev only: production is three independent classic bundles from scripts/build.mjs.
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify("dev"), __PRODUCTION__: "false" },
  build: { target: "chrome70", cssTarget: "chrome70" },
});
