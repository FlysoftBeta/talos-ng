import { aiSuite } from "./suite.mjs";

export default {
  name: "ai",
  server: "real",
  run: ({ adapter, legacy }, server) => aiSuite(adapter, server, { legacy }),
};
