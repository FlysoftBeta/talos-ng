import { matchesAny } from "./glob.mjs";

// Policy rule:
//   { id, from, fromIgnore?, forbid, allow?, typeOnlyAllowed?, skipTests?, reason }
// `from`/`fromIgnore` are globs on the importing file relative to its package
// (or tool) root. `forbid`/`allow` are globs matched against three views of the
// import: the raw specifier, the target relative to the importer's package root,
// and the target relative to the repository root. `allow` carves exceptions out
// of `forbid`; `typeOnlyAllowed` lets `import type` through.
export function evaluateLayers(rules, ctx) {
  const violations = [];
  const views = [ctx.specifier, ctx.targetInPackage, ctx.targetInRepo];
  for (const rule of rules) {
    if (rule.skipTests && ctx.test) continue;
    if (!matchesAny(rule.from, ctx.file)) continue;
    if (rule.fromIgnore && matchesAny(rule.fromIgnore, ctx.file)) continue;
    if (!matchesAny(rule.forbid, ...views)) continue;
    if (rule.allow && matchesAny(rule.allow, ...views)) continue;
    if (rule.typeOnlyAllowed && ctx.typeOnly) continue;
    violations.push({ rule: rule.id, target: ctx.target, reason: rule.reason });
  }
  return violations;
}
// Peer rule: sibling directories under `root` may only be imported through an
// entry file (`index.ts`, `ports.ts` ...). Applies to the first path segment.
export function evaluatePeers(peers, ctx) {
  const violations = [];
  if (!ctx.targetInPackage) return violations;
  for (const peer of peers ?? []) {
    const own = new RegExp(`^${peer.root}/([^/]+)/`).exec(ctx.file);
    const other = new RegExp(`^${peer.root}/([^/]+)(?:/(.*))?$`).exec(
      ctx.targetInPackage,
    );
    if (!own || !other || own[1] === other[1]) continue;
    const entry = new RegExp(`^(?:${peer.entries.join("|")})(?:\\.[a-z]+)?$`);
    if (other[2] === undefined || entry.test(other[2])) continue;
    violations.push({
      rule: peer.id ?? "peer-entry",
      target: ctx.target,
      reason: peer.reason,
    });
  }
  return violations;
}
