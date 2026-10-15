import { opsSuite, packagedOpsSuite } from "./suite.mjs";

/** Ops panels against the static gallery; the packaged-host check runs once, after the browser work (current only). */
export default {
  name: "ops",
  server: "static",
  run: ({ adapter, legacy }, server) => opsSuite(adapter, server, { legacy }),
  after: ({ legacy }) => (legacy ? undefined : packagedOpsSuite()),
};
