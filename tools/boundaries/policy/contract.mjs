export default {
  edges: [
    {
      to: "tools/compat-check/check.mjs",
      reason:
        "The contract build script verifies its bundle with the ES2018 compat checker.",
    },
  ],
  layers: [
    {
      id: "contract-protocol-leaf",
      from: "src/protocol/**",
      forbid: [
        "src/modules/**",
        "src/policy/**",
        "src/registry.ts",
        "src/api.ts",
        "src/index.ts",
      ],
      reason:
        "The protocol layer knows no domain, policy or registry; everything depends on it.",
    },
    {
      id: "contract-policy-below-modules",
      from: "src/policy/**",
      fromIgnore: "src/policy/actions.ts",
      forbid: "src/modules/**",
      reason:
        "Role and feature vocabulary is below the domains; only the aggregate actions consume them.",
    },
    {
      id: "contract-modules-no-aggregate",
      from: "src/modules/**",
      forbid: [
        "src/registry.ts",
        "src/api.ts",
        "src/index.ts",
        "src/policy/actions.ts",
      ],
      reason:
        "Domain modules never import the aggregate registry, API, package entry or aggregate actions.",
    },
  ],
};
