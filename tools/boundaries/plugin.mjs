import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkImport } from "./graph.mjs";
import { evaluateLayers, evaluatePeers } from "./layers.mjs";
import { matchesAny } from "./glob.mjs";
import { policyFor } from "./policy/index.mjs";
import { relativeInside, resolveRelative } from "./resolve.mjs";
import { exceptionKey, loadExceptions } from "./exceptions.mjs";

export const TEST_FILE = /(?:\.test\.|(?:^|\/)tests\/)/;
const roots = new Map();
/** Nearest ancestor containing pnpm-workspace.yaml; the repository root. */
function findRoot(directory) {
  const known = roots.get(directory);
  if (known !== undefined) return known || undefined;
  let found = "";
  for (let dir = directory; ; dir = path.posix.dirname(dir)) {
    if (!/^(?:\/|[A-Za-z]:\/)/.test(dir)) break;
    if (existsSync(`${dir}/pnpm-workspace.yaml`)) {
      found = dir;
      break;
    }
    if (path.posix.dirname(dir) === dir) break;
  }
  roots.set(directory, found);
  return found || undefined;
}
/** Locate a file in the workspace: {repo, kind, owner, root, local, repoFile}. */
export function locate(rawName) {
  const filename = rawName.replaceAll("\\", "/");
  const repo = findRoot(path.posix.dirname(filename));
  let rel;
  if (repo) rel = filename.slice(repo.length + 1);
  else {
    const at = /(?:^|\/)((?:packages|tools)\/.*)$/.exec(filename);
    if (!at) return;
    rel = at[1];
  }
  const prefix = repo
    ? `${repo}/`
    : filename.slice(0, filename.length - rel.length);
  let match = /^(packages|tools)\/([^/]+)\/(.+)$/.exec(rel);
  if (match)
    return {
      repo: prefix,
      filename,
      kind: match[1] === "packages" ? "package" : "tool",
      owner: match[2],
      root: `${prefix}${match[1]}/${match[2]}/`,
      local: match[3],
      repoFile: rel,
    };
  match = /^tools\/([^/]+\.mjs)$/.exec(rel);
  if (match)
    return {
      repo: prefix,
      filename,
      kind: "tool",
      owner: "tools",
      root: `${prefix}tools/`,
      local: match[1],
      repoFile: rel,
    };
}
function readManifest(info) {
  try {
    return JSON.parse(readFileSync(`${info.root}package.json`, "utf8"));
  } catch {
    return {};
  }
}
let recorded;
function recordedSet() {
  recorded ??= new Set(loadExceptions().map(exceptionKey));
  return recorded;
}
export const boundaryPlugin = {
  rules: {
    imports: {
      meta: {
        type: "problem",
        schema: [
          {
            type: "object",
            properties: {
              collect: { type: "boolean" },
              exceptions: { type: "array" },
            },
            additionalProperties: false,
          },
        ],
        messages: {
          plain: "{{message}}",
          layer: "{{reason}} [{{rule}} -> {{target}}]",
        },
      },
      create(context) {
        const collect = context.options[0]?.collect === true;
        // `exceptions` replaces exceptions.json (tests only).
        const given = context.options[0]?.exceptions;
        const recordedKeys = given
          ? new Set(given.map(exceptionKey))
          : recordedSet();
        const info = locate(context.filename);
        if (!info) return {};
        const { policy, layers } = policyFor(info.kind, info.owner);
        const manifest = readManifest(info);
        const test = TEST_FILE.test(info.local);
        // Build scripts, bin entries and configs are Node tooling, whatever the
        // package's runtime environment.
        const tooling =
          info.kind === "package" && !info.local.startsWith("src/");
        const declared = {
          ...manifest.dependencies,
          ...manifest.peerDependencies,
          ...(test ? manifest.devDependencies : {}),
        };
        function inspect(node, source, typeOnly = false) {
          if (typeof source !== "string") {
            // Tools compute paths (vite, child entry points); packages do not.
            if (info.kind === "tool" || tooling) return;
            context.report({
              node,
              messageId: "plain",
              data: {
                message:
                  "Imports must use a static string so boundaries can be checked.",
              },
            });
            return;
          }
          const plain = (message) =>
            context.report({ node, messageId: "plain", data: { message } });
          const message = checkImport({
            owner: info.owner,
            source,
            typeOnly,
            declared,
            test,
            tooling,
          });
          if (message) plain(message);
          let targetInPackage;
          let targetInRepo;
          if (source.startsWith(".")) {
            const resolved = resolveRelative(info.filename, source);
            targetInPackage = relativeInside(info.root, resolved);
            targetInRepo = relativeInside(info.repo, resolved);
            if (targetInPackage === undefined) {
              const edge = (policy.edges ?? []).find((e) =>
                matchesAny(e.to, targetInRepo),
              );
              if (!edge)
                plain(
                  targetInRepo === undefined
                    ? "Relative imports may not leave the repository."
                    : "Cross-package relative imports are forbidden; declare a workspace dependency or a named policy edge.",
                );
            }
          }
          const ctx = {
            file: info.local,
            test,
            typeOnly,
            specifier: source,
            targetInPackage,
            targetInRepo,
            target: targetInRepo ?? source,
          };
          const found = [
            ...evaluateLayers(layers, ctx),
            ...evaluatePeers(policy.peers, ctx),
          ];
          for (const violation of found) {
            if (
              !collect &&
              recordedKeys.has(
                exceptionKey({
                  rule: violation.rule,
                  file: info.repoFile,
                  target: violation.target,
                }),
              )
            )
              continue;
            context.report({
              node,
              messageId: "layer",
              data: {
                reason: violation.reason,
                rule: violation.rule,
                target: violation.target,
              },
            });
          }
        }
        return {
          ImportDeclaration(node) {
            inspect(
              node,
              node.source.value,
              node.importKind === "type" ||
                (node.specifiers.length > 0 &&
                  node.specifiers.every((s) => s.importKind === "type")),
            );
          },
          ExportNamedDeclaration(node) {
            if (node.source)
              inspect(
                node,
                node.source.value,
                node.exportKind === "type" ||
                  (node.specifiers.length > 0 &&
                    node.specifiers.every((s) => s.exportKind === "type")),
              );
          },
          ExportAllDeclaration(node) {
            inspect(node, node.source.value, node.exportKind === "type");
          },
          ImportExpression(node) {
            inspect(node, node.source.value);
          },
          TSImportType(node) {
            const argument = node.source ?? node.argument;
            inspect(node, argument.value ?? argument.literal?.value, true);
          },
          CallExpression(node) {
            if (node.callee.name === "require")
              inspect(node, node.arguments[0]?.value);
          },
        };
      },
    },
  },
};
