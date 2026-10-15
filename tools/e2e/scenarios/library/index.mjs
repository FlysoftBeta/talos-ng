import { librarySuite } from "./suite.mjs";

/** Library and reader: import, conversion, virtual PDF window, retention, sharing, offline resume. */
export default {
  name: "library",
  server: "real",
  run: ({ adapter, legacy }, server) =>
    librarySuite(adapter, server, { legacy }),
};
