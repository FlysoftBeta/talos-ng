export default {
  tool: { environment: "node", imports: { launcher: "all" } },
  edges: [
    {
      to: "packages/launcher/src/{index.ts,release/target.ts}",
      reason: "Packaging reads the launcher archive/target source directly.",
    },
    {
      to: "packages/contract/src/index.ts",
      reason: "e2e.mjs builds a typed API client against the packaged server.",
    },
    {
      to: "packages/link/src/{index.ts,ws-node/index.ts}",
      reason:
        "e2e.mjs connects to the packaged server over the Node link carrier.",
    },
    {
      to: "packages/server/src/kernel/persistence/db.ts",
      reason: "e2e.mjs inspects the packaged server database.",
    },
  ],
};
