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
      id: "server-kernel-independent",
      from: "src/kernel/**",
      forbid: ["src/modules/**", "src/app/**"],
      reason:
        "Kernel mechanisms must not import domain modules or application assembly.",
    },
  ],
};
