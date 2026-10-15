export default {
  layers: [
    {
      id: "objectstore-memory-no-filesystem",
      from: "src/memory/**",
      forbid: "src/filesystem/**",
      reason: "The memory backend must not depend on the filesystem adapter.",
    },
    {
      id: "objectstore-errors-no-filesystem",
      from: "src/errors.ts",
      forbid: "src/filesystem/**",
      reason: "Error normalisation performs no filesystem I/O.",
    },
    {
      id: "objectstore-content-no-backends",
      from: "src/content/**",
      forbid: ["src/filesystem/**", "src/lifecycle/**", "src/memory/**"],
      reason: "Object content rules sit below the lifecycle and every backend.",
    },
    {
      id: "objectstore-lifecycle-no-backends",
      from: "src/lifecycle/**",
      forbid: ["src/filesystem/**", "src/memory/**"],
      reason: "The lifecycle takes its backend by injection, never by import.",
    },
    {
      id: "objectstore-ports-pure",
      from: "src/ports.ts",
      forbid: [
        "src/content/**",
        "src/lifecycle/**",
        "src/filesystem/**",
        "src/memory/**",
        "src/errors.ts",
      ],
      reason: "Ports declare types only and have no implementation dependency.",
    },
  ],
};
