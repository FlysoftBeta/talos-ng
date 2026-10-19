import { opsSuite, packagedOpsSuite } from "./suite.mjs";

/**
 * Ops panels against the static gallery; the packaged-host check (which packages releases
 * itself) runs once, after the browser work, on current Chromium only and not when
 * TALOS_E2E_PACKAGED=0 (per-commit CI, which does not build packages).
 */
export default {
  name: "ops",
  server: "static",
  run: ({ adapter, legacy }, server) => opsSuite(adapter, server, { legacy }),
  after: ({ legacy }) =>
    legacy || process.env.TALOS_E2E_PACKAGED === "0"
      ? undefined
      : packagedOpsSuite(),
};
