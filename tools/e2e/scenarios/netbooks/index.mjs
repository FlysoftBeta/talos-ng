import { netbooksSuite } from "./suite.mjs";

export default {
  name: "netbooks",
  server: "real",
  run: ({ adapter, legacy }, server) =>
    netbooksSuite(adapter, server, { legacy }),
};
