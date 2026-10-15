import { chatSuite } from "./suite.mjs";
import { chatLegacySuite } from "./legacy-suite.mjs";

/** Current Chromium drives several Playwright contexts; Chrome 70 runs the single-page variant. */
export default {
  name: "chat",
  server: "real",
  run: ({ adapter, playwright, legacy }, server) =>
    legacy ? chatLegacySuite(adapter, server) : chatSuite(playwright, server),
};
