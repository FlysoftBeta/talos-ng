export default {
  // Sibling modules talk through a peer's ports.ts or index.ts only.
  peers: [
    {
      root: "src/modules",
      entries: ["index", "ports"],
      reason:
        "Feature modules must import one another through ports.ts or index.ts.",
    },
  ],
  layers: [
    {
      id: "server-migration-entry-private",
      from: "src/**",
      fromIgnore: "src/migration.ts",
      forbid: ["src/migration.ts"],
      reason:
        "src/migration.ts is the offline importer's entry, not product API.",
    },
    {
      id: "server-kernel-independent",
      from: "src/kernel/**",
      forbid: ["src/modules/**", "src/app/**"],
      reason:
        "Kernel mechanisms must not import domain modules or application assembly.",
    },
  ],
};
