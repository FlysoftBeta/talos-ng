import { parse } from "acorn";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Stable rule IDs are used by reviewed, file-specific polyfill exceptions.
/** @type {Array<[string, RegExp]>} */
export const jsRules = [
  ["globalThis", /\bglobalThis\b/g],
  ["queueMicrotask", /\bqueueMicrotask\b/g],
  ["Promise.allSettled", /\bPromise\s*\.\s*allSettled\b/g],
  ["Object.fromEntries", /\bObject\s*\.\s*fromEntries\b/g],
  ["flat", /\.\s*flat(?:Map)?\s*\(/g],
  ["ResizeObserver", /\bnew\s+ResizeObserver\s*\(/g],
  ["IntersectionObserver", /\bnew\s+IntersectionObserver\s*\(/g],
  ["matchAll", /\.\s*matchAll\b/g],
  ["replaceAll", /\.\s*replaceAll\b/g],
  ["at", /\.\s*at\s*\(/g],
  ["structuredClone", /\bstructuredClone\b/g],
  ["BigInt", /\bBigInt\b/g],
  ["import.meta", /\bimport\s*\.\s*meta\b/g],
];
/** @type {Array<[string, RegExp]>} */
export const cssRules = [
  ["focus-visible", /:focus-visible\b/gi],
  ["gap", /(?:^|[;{\s])(?:gap|row-gap|column-gap)\s*:/gi],
  ["inset", /\binset\s*:/gi],
  ["aspect-ratio", /\baspect-ratio\s*:/gi],
  ["clamp", /\bclamp\s*\(/gi],
  ["min/max", /\b(?:min|max)\s*\(/gi],
  ["is/where", /:(?:is|where)\s*\(/gi],
  ["backdrop-filter", /\bbackdrop-filter\s*:/gi],
];
/** @typedef {{file: string, rule: string, justification: string}} AllowEntry */
/** @typedef {{file: string, rule: string, line: number, message: string}} Finding */
/** @param {unknown} input @returns {AllowEntry[]} */
export function validateAllowlist(input) {
  if (!Array.isArray(input)) throw new TypeError("Allow-list must be an array");
  const ids = new Set(jsRules.map(([id]) => id));
  const seen = new Set();
  return input.map((entry) => {
    if (
      !entry ||
      typeof entry.file !== "string" ||
      !entry.file ||
      entry.file.includes("\\") ||
      entry.file.startsWith("/") ||
      entry.file.split("/").includes("..") ||
      !ids.has(entry.rule) ||
      typeof entry.justification !== "string" ||
      !entry.justification.trim()
    )
      throw new TypeError(
        "Each allow-list entry needs a relative file, a JS API rule, and a justification",
      );
    const key = `${entry.file}:${entry.rule}`;
    if (seen.has(key)) throw new TypeError(`Duplicate allow-list entry ${key}`);
    seen.add(key);
    return entry;
  });
}
/** @param {string} source @param {string} file @param {AllowEntry[]} [allowlist] @returns {Finding[]} */
export function checkSource(source, file, allowlist = []) {
  /** @type {Finding[]} */
  const findings = [];
  if (/\.html$/.test(file)) {
    for (const match of source.matchAll(
      /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
    )) {
      if (/\bsrc\s*=|\btype\s*=\s*["']application\/json/.test(match[1] ?? ""))
        continue;
      findings.push(
        ...checkSource(match[2] ?? "", `${file}.inline.js`, allowlist),
      );
    }
    for (const match of source.matchAll(
      /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,
    ))
      findings.push(
        ...checkSource(match[1] ?? "", `${file}.inline.css`, allowlist),
      );
    return findings;
  }
  if (file.endsWith(".css"))
    source = source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.replace(/[^\n]/g, " "),
    );
  const isJS = file.endsWith(".js");
  /** @type {(import("acorn").Token & {value?: unknown})[] | undefined} */
  let jsTokens;
  if (!isJS && !file.endsWith(".css")) return findings;
  if (isJS) {
    try {
      /** @type {(import("acorn").Token & {value?: unknown})[]} */
      const tokens = [];
      parse(source, {
        ecmaVersion: 2018,
        sourceType: "module",
        locations: true,
        onToken: tokens,
      });
      jsTokens = tokens;
    } catch (error) {
      const failure = /** @type {Error & {loc?: {line: number}}} */ (error);
      findings.push({
        file,
        rule: "syntax",
        line: failure.loc?.line ?? 1,
        message: failure.message,
      });
    }
  }
  const rules = isJS ? jsRules : cssRules;
  for (const [rule, pattern] of rules) {
    if (allowlist.some((entry) => entry.file === file && entry.rule === rule))
      continue;
    // Observer constructors require a feature-detection branch in the same asset.
    // This is a conservative textual gate, not control-flow proof; source fallback
    // review and the real Chrome 70 suites remain required.
    if (
      (rule === "ResizeObserver" || rule === "IntersectionObserver") &&
      new RegExp(`typeof\\s+${rule}\\b`).test(source)
    )
      continue;
    pattern.lastIndex = 0;
    /** @type {RegExpExecArray | null} */
    let match;
    while ((match = pattern.exec(source))) {
      const offset = match.index;
      // Diagnostics may contain the word BigInt. Tokens distinguish literal text
      // from executable identifiers, including identifiers in template expressions.
      // Preserve bracket access such as window["BigInt"] and window[`BigInt`].
      if (
        rule === "BigInt" &&
        jsTokens &&
        !jsTokens.some((token, index) => {
          if (offset < token.start || offset >= token.end) return false;
          if (token.type.label === "name" && token.value === "BigInt")
            return true;
          if (token.type.label === "string" && token.value === "BigInt")
            return (
              jsTokens[index - 1]?.type.label === "[" &&
              jsTokens[index + 1]?.type.label === "]"
            );
          if (token.type.label === "template" && token.value === "BigInt")
            return (
              jsTokens[index - 2]?.type.label === "[" &&
              jsTokens[index + 2]?.type.label === "]"
            );
          return false;
        })
      )
        continue;
      findings.push({
        file,
        rule,
        line: source.slice(0, match.index).split("\n").length,
        message: `Chrome 70 unsupported: ${rule}`,
      });
    }
  }
  return findings;
}
/** @param {string} directory @param {AllowEntry[]} [allowlist] */
export function checkDirectory(directory, allowlist = []) {
  const allowed = validateAllowlist(allowlist);
  /** @type {Finding[]} */
  const findings = [];
  let files = 0;
  /** @param {string} dir */
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && /\.(js|css|html)$/.test(entry.name)) {
        files++;
        findings.push(
          ...checkSource(
            readFileSync(full, "utf8"),
            path.relative(directory, full).split(path.sep).join("/"),
            allowed,
          ),
        );
      }
    }
  }
  visit(directory);
  return { files, findings };
}
