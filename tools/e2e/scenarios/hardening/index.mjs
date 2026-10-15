import { hardeningSuite } from "./suite.mjs";

export default {
  name: "hardening",
  server: "real",
  run: ({ adapter, legacy }, server) =>
    hardeningSuite(adapter, server, { legacy }),
};
