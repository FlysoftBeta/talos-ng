export default {
  tool: {
    environment: "node",
    // The importer reaches the server through its narrow migration entry only.
    entries: { server: "@talos/server/migration" },
    imports: {
      base: "all",
      server: "all",
      objectstore: "all",
      contract: "all",
      link: "test",
    },
  },
  edges: [],
  layers: [],
};
