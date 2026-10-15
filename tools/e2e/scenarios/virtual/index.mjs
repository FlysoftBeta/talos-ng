import assert from "node:assert/strict";
import { virtualSuite } from "./suite.mjs";

/** Real-browser behaviour of the virtual scroller on the gallery test bench. */
export default {
  name: "virtual",
  server: "static",
  run: async ({ adapter }, server) => {
    const initial = adapter.errors.length;
    await virtualSuite(adapter.cdp, server);
    assert.deepEqual(
      adapter.errors.slice(initial),
      [],
      "virtual bench has no browser or observer-loop errors",
    );
  },
};
