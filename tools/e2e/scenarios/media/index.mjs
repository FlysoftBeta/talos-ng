import { mediaSuite } from "./suite.mjs";

export default {
  name: "media",
  server: "real",
  run: ({ adapter, legacy }, server) => mediaSuite(adapter, server, { legacy }),
};
