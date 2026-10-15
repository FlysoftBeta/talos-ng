export default {
  peers: [
    {
      root: "src/features",
      entries: ["index", "model"],
      reason:
        "Feature modules must import one another through index.ts, or model.ts (TSX-free) from a model.",
    },
  ],
  layers: [
    {
      id: "client-core-independent",
      from: "src/core/**",
      forbid: [
        "src/app/**",
        "src/features/**",
        "src/ui/**",
        "src/platform/**",
        "react",
      ],
      skipTests: true,
      reason:
        "core is framework-free runtime: no app, features, ui, platform or react.",
    },
    {
      id: "client-ui-independent",
      from: "src/ui/**",
      forbid: [
        "src/core/**",
        "src/features/**",
        "src/app/**",
        "src/platform/**",
      ],
      reason:
        "ui components are presentational: no core, features, app or platform.",
    },
    {
      id: "client-ui-no-contract-values",
      from: "src/ui/**",
      forbid: ["@talos/contract", "@talos/contract/**"],
      typeOnlyAllowed: true,
      reason: "ui takes data as props: no @talos/contract value imports.",
    },
    {
      id: "client-model-pure",
      from: ["src/features/*/model/**", "src/features/*/model.ts"],
      forbid: [
        "react",
        "react/**",
        "react-dom",
        "react-dom/**",
        "@mui/**",
        "**/*.css",
        "**/*.tsx",
        "src/ui/**",
        "src/platform/**",
        "src/app/**",
      ],
      reason: "Feature models have no React, MUI, CSS, tsx or ui imports.",
    },
    {
      id: "client-view-no-runtime",
      from: ["src/features/*/view/**", "src/features/*/view.tsx"],
      forbid: ["src/core/**", "src/platform/**", "src/app/**"],
      typeOnlyAllowed: true,
      skipTests: true,
      reason: "Feature views receive state and callbacks; core is type-only.",
    },
    {
      id: "client-view-no-contract-values",
      from: ["src/features/*/view/**", "src/features/*/view.tsx"],
      forbid: ["@talos/contract", "@talos/contract/**"],
      typeOnlyAllowed: true,
      reason:
        "Feature views take data as props: no @talos/contract value imports.",
    },
    {
      id: "client-library-no-reader",
      from: "src/features/library/**",
      forbid: ["src/features/reader/**"],
      reason:
        "reader depends on library's document model; app/areas.tsx supplies the reader slot.",
    },
    {
      id: "client-netbooks-isolated",
      from: "src/features/netbooks/**",
      forbid: ["src/features/library/**", "src/features/reader/**"],
      reason:
        "netbooks receives its library destinations from app composition.",
    },
    {
      id: "client-connect-binds-only",
      from: ["src/features/*/connect/**", "src/features/*/connect.tsx"],
      forbid: [
        "@talos/store",
        "@talos/store/**",
        "@talos/link",
        "@talos/link/**",
        "@talos/shell",
        "src/platform/storage/**",
        "src/platform/transport/**",
      ],
      skipTests: true,
      reason:
        "connect binds models to React; storage and transport stay behind ports.",
    },
    {
      id: "client-platform-below-features",
      from: "src/platform/**",
      forbid: ["src/app/**", "src/features/**", "src/ui/**"],
      reason:
        "platform adapts browser/storage/transport/react; it knows no feature.",
    },
    {
      id: "client-features-below-app",
      from: ["src/features/**", "src/ui/**"],
      forbid: ["src/app/**"],
      skipTests: true,
      reason:
        "app composes features; nothing below imports the composition root.",
    },
    {
      id: "client-dev-isolated",
      from: "src/**",
      fromIgnore: "src/dev/**",
      forbid: ["src/dev/**"],
      reason: "Development galleries are imported only by src/dev itself.",
    },
  ],
};
