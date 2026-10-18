export default {
  tool: { environment: "node", imports: {} },
  edges: [
    {
      to: "packages/server/src/kernel/config/config.ts",
      reason: "dev.mjs reuses the server runtime configuration loader.",
    },
    {
      to: "packages/launcher/src/install/layout.ts",
      reason: "dev.mjs lays out a checkout run like an install.",
    },
    {
      to: "packages/launcher/src/process/server-start.ts",
      reason:
        "dev.mjs and the real-server harness send the server its typed start message.",
    },
    {
      to: "tools/package/media-binary.ts",
      reason:
        "dev.mjs fetches the pinned yt-dlp into the cache that packaging uses.",
    },
    {
      to: "tools/legacy-chromium/{prepare,cdp}.mjs",
      reason: "Legacy-browser runs launch the pinned Chrome 70 helper.",
    },
  ],
};
