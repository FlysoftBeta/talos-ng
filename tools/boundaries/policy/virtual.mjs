export default {
  layers: [
    {
      id: "virtual-core-no-dom",
      from: ["src/core/**", "src/sources/**", "src/index.ts"],
      forbid: ["src/dom/**"],
      reason:
        "The scroller state machine and sources are DOM-free; only src/dom binds them to elements.",
    },
    {
      id: "virtual-core-no-sources",
      from: "src/core/**",
      forbid: "src/sources/**",
      skipTests: true,
      reason:
        "Sources implement the core protocol; the core never depends on one.",
    },
  ],
};
