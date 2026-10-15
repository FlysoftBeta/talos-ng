export default {
  tool: { environment: "node", imports: {} },
  edges: [
    {
      to: "tools/boundaries.mjs",
      reason: "The engine's tests exercise its public entry point.",
    },
  ],
};
