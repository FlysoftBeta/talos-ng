import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Transitional violations, recorded exactly. Layer entries are
// {rule, file, target}; SQL entries are {rule: "sql-owner", file, table}.
// Regenerate with `node tools/boundaries/ratchet.mjs --write`.
export const exceptionsFile = fileURLToPath(
  new URL("./exceptions.json", import.meta.url),
);
export function exceptionKey(entry) {
  return [entry.rule, entry.file, entry.table ?? entry.target].join("\0");
}
export function describe(entry) {
  return entry.rule === "sql-owner"
    ? `${entry.rule} ${entry.file} ${entry.table}`
    : `${entry.rule} ${entry.file} -> ${entry.target}`;
}
export function sortEntries(entries) {
  return [...entries].sort((a, b) =>
    exceptionKey(a) < exceptionKey(b)
      ? -1
      : exceptionKey(a) > exceptionKey(b)
        ? 1
        : 0,
  );
}
export function loadExceptions(file = exceptionsFile) {
  try {
    return JSON.parse(readFileSync(file, "utf8")).exceptions ?? [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
export function serialiseExceptions(entries) {
  if (entries.length === 0) return `{\n  "exceptions": []\n}\n`;
  const lines = sortEntries(entries).map(
    (entry) => `    ${JSON.stringify(entry)}`,
  );
  return `{\n  "exceptions": [\n${lines.join(",\n")}\n  ]\n}\n`;
}
export function writeExceptions(entries, file = exceptionsFile) {
  writeFileSync(file, serialiseExceptions(entries));
}
/** Exact comparison: entries needed but missing, and entries no longer needed. */
export function diffExceptions(actual, recorded) {
  const have = new Map(recorded.map((entry) => [exceptionKey(entry), entry]));
  const need = new Map(actual.map((entry) => [exceptionKey(entry), entry]));
  return {
    added: [...need]
      .filter(([key]) => !have.has(key))
      .map(([, entry]) => entry),
    stale: [...have]
      .filter(([key]) => !need.has(key))
      .map(([, entry]) => entry),
  };
}
