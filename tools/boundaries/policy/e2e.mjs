export default {
  tool: { environment: "node", imports: {} },
  edges: [
    {
      to: "packages/server/src/kernel/config/config.ts",
      reason: "dev.mjs reuses the server runtime configuration loader.",
    },
    {
      to: "tools/legacy-chromium/{prepare,cdp}.mjs",
      reason: "Legacy-browser runs launch the pinned Chrome 70 helper.",
    },
  ],
};
