import { virtualSuite } from "./suite.mjs";

/** Real-browser behaviour of the virtual scroller on the gallery test bench. */
export default {
  name: "virtual",
  server: "static",
  run: ({ adapter }, server) => virtualSuite(adapter.cdp, server),
};
