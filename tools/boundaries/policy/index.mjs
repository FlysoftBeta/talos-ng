import boundaries from "./boundaries.mjs";
import client from "./client.mjs";
import contract from "./contract.mjs";
import compatCheck from "./compat-check.mjs";
import docpipe from "./docpipe.mjs";
import e2e from "./e2e.mjs";
import launcher from "./launcher.mjs";
import legacyChromium from "./legacy-chromium.mjs";
import migrate from "./migrate.mjs";
import packageTool from "./package.mjs";
import objectstore from "./objectstore.mjs";
import product from "./product.mjs";
import server from "./server.mjs";
import store from "./store.mjs";
import tools from "./tools.mjs";
import virtual from "./virtual.mjs";

// One small file per owner. Packages without a file only get the shared
// product rules and the package DAG in ../graph.mjs. A policy file is
//   { tool?: {environment, imports},  // tools only: workspace dependency map
//     edges?: [{to, reason}],         // named relative imports that leave the owner
//     peers?: [{root, entries, reason}],
//     layers?: [{id, from, forbid, ...}] }  // see ../layers.mjs
export const policies = {
  boundaries,
  client,
  contract,
  "compat-check": compatCheck,
  docpipe,
  e2e,
  launcher,
  "legacy-chromium": legacyChromium,
  migrate,
  objectstore,
  package: packageTool,
  server,
  store,
  tools,
  virtual,
};
export function policyFor(kind, owner) {
  const policy = policies[owner] ?? {};
  const own = policy.layers ?? [];
  return {
    policy,
    layers: kind === "package" ? [...product.layers, ...own] : own,
  };
}
