import { builtinModules } from "node:module";
import { policies } from "./policy/index.mjs";

// Values are runtime/type imports, or type-only imports. One normative graph.
export const boundaries = {
  base: { environment: "isomorphic", imports: {} },
  link: { environment: "isomorphic", imports: { base: "all" } },
  sync: { environment: "isomorphic", imports: { base: "all" } },
  docpack: { environment: "isomorphic", imports: { base: "all" } },
  contract: {
    environment: "isomorphic",
    imports: { base: "all", docpack: "type" },
  },
  objectstore: { environment: "node", imports: { base: "all" } },
  docpipe: {
    environment: "node",
    imports: { base: "all", docpack: "all", objectstore: "type" },
  },
  store: { environment: "browser", imports: { base: "all" } },
  virtual: { environment: "browser", imports: {} },
  server: {
    environment: "node",
    imports: {
      base: "all",
      link: "all",
      sync: "all",
      docpack: "all",
      contract: "all",
      objectstore: "all",
      docpipe: "all",
      launcher: "all",
    },
  },
  client: {
    environment: "browser",
    imports: {
      base: "all",
      link: "all",
      sync: "all",
      docpack: "all",
      contract: "all",
      store: "all",
      shell: "all",
      virtual: "all",
    },
  },
  shell: { environment: "browser", imports: {} },
  launcher: { environment: "node", imports: { base: "all" } },
};
// Tool boundaries live next to the other per-owner policy in policy/<tool>.mjs.
// Permission "test" means: workspace dependency allowed in test files only.
export const toolBoundaries = Object.fromEntries(
  Object.entries(policies)
    .filter(([, policy]) => policy.tool)
    .map(([name, policy]) => [name, policy.tool]),
);
const builtins = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);
export function checkImport({
  owner,
  source,
  typeOnly = false,
  declared = {},
  test = false,
  tooling = false,
}) {
  const rule = boundaries[owner] ?? toolBoundaries[owner];
  if (!rule) return `Unknown package ${owner}; add an explicit boundary.`;
  if (
    !test &&
    !tooling &&
    rule.environment !== "node" &&
    (source.startsWith("node:") || builtins.has(source))
  )
    return `Node built-in ${source} is forbidden in ${owner}.`;
  if (!source.startsWith("@talos/")) return;
  const target = source.split("/")[1];
  if (target === owner) return;
  const permission = rule.imports[target];
  if (!permission || (permission === "test" && !test))
    return `${owner} may not import @talos/${target}.`;
  if (permission === "type" && !typeOnly)
    return `${owner} may only import types from @talos/${target}.`;
  if (!declared[`@talos/${target}`]?.startsWith("workspace:"))
    return `Undeclared workspace dependency @talos/${target} in ${owner}.`;
  // The objectstore conformance suite is an explicit public test entry point.
  if (test && source === "@talos/objectstore/testing") return;
  if (target === "link" && source === "@talos/link/ws-node") {
    if (rule.environment !== "node" && !test)
      return `Node carrier ${source} is forbidden in ${owner}.`;
    return;
  }
  if (target === "link" && source === "@talos/link/ws-browser") return;
  // The DOM driver of the virtual scroller is its browser entry.
  if (target === "virtual" && source === "@talos/virtual/dom") return;
  // A named subpath entry: the one way a tool may reach a package's internals.
  const entry = rule.entries?.[target];
  if (entry) {
    if (source === entry) return;
    return `${owner} may only import @talos/${target} through ${entry}.`;
  }
  if (source === "@talos/server/migration")
    return "The migration entry is for tools/migrate only.";
  if (source !== `@talos/${target}`)
    return `Import @talos/${target} through its public entry point.`;
}
