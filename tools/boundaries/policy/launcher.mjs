export default {
  layers: [
    {
      id: "launcher-logging-no-release",
      from: "src/logging/**",
      forbid: "src/release/**",
      reason: "Logging must not depend on release staging.",
    },
    {
      id: "launcher-process-no-release",
      from: "src/process/**",
      forbid: "src/release/**",
      reason: "Process supervision must not depend on release staging.",
    },
    {
      id: "launcher-install-leaf",
      from: "src/install/**",
      forbid: ["src/release/**", "src/process/**", "src/logging/**"],
      reason:
        "The install layout is read by the launcher and the server alike.",
    },
    {
      id: "launcher-filesystem-leaf",
      from: "src/filesystem/**",
      forbid: ["src/release/**", "src/process/**", "src/logging/**"],
      reason: "The busy-retry policy is a leaf used by every other area.",
    },
  ],
};
