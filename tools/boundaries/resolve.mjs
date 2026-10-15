import { statSync } from "node:fs";
import path from "node:path";

// Pure-POSIX resolution: callers normalise Windows separators first, so a
// `C:/repo/...` name behaves identically on every platform.
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"];
const JS_TO_TS = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};
const KNOWN_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  ".jsx",
  ".cjs",
  ".json",
  ".css",
  ".svg",
  ".png",
  ".md",
  ".pem",
  ".wasm",
]);
export function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
/**
 * Resolve a relative specifier from `fromFile` (absolute, `/`-separated) to the
 * file it names: `.js` -> `.ts/.tsx`, extensionless -> source extension, and
 * directory -> `index.*`. When nothing exists on disk (virtual fixtures) the
 * lexical result is returned so path rules still apply.
 */
export function resolveRelative(fromFile, specifier, exists = isFile) {
  const bare = specifier.replace(/[?#].*$/, "");
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromFile), bare),
  );
  const trimmed = base.length > 1 ? base.replace(/\/+$/, "") : base;
  const ext = path.posix.extname(trimmed);
  const candidates = [];
  if (JS_TO_TS[ext]) {
    const stem = trimmed.slice(0, -ext.length);
    for (const alt of JS_TO_TS[ext]) candidates.push(stem + alt);
    candidates.push(trimmed);
  } else if (KNOWN_EXTENSIONS.has(ext) && !bare.endsWith("/")) {
    candidates.push(trimmed);
  } else {
    for (const alt of SOURCE_EXTENSIONS) candidates.push(trimmed + alt);
  }
  for (const alt of SOURCE_EXTENSIONS)
    candidates.push(`${trimmed}/index${alt}`);
  const found = candidates.find((candidate) => exists(candidate));
  if (found) return found;
  const fallback = JS_TO_TS[ext]
    ? trimmed.slice(0, -ext.length) + JS_TO_TS[ext][0]
    : trimmed;
  return fallback;
}
/** `file` relative to `root` (both `/`-separated), or undefined when it escapes. */
export function relativeInside(root, file) {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : undefined;
}
