export default {
  layers: [
    {
      id: "store-database-kv-no-files",
      from: ["src/database/**", "src/kv/**"],
      forbid: "src/files/**",
      reason:
        "Files build on the database; the database and KV never import file storage.",
    },
  ],
};
