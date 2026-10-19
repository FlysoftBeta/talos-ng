import { pdfSuite } from "./suite.mjs";

/**
 * PDF reading the way a school tablet reaches the server: by its LAN name over HTTP, sent to
 * HTTPS (and a ServiceWorker) from Chromium 80 on, otherwise staying on HTTP. Rendering,
 * ranged pack transfer, retention into IndexedDB and reading from storage offline.
 */
export default {
  name: "pdf",
  server: "real",
  https: true,
  run: (ctx, server) => pdfSuite(ctx, server),
};
