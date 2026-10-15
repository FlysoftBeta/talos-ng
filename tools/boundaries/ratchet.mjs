// Exception ratchet. The recorded list in exceptions.json may only shrink.
//   node tools/boundaries/ratchet.mjs --write   regenerate after moves/merges
//   node tools/boundaries/ratchet.mjs --check   fail on new or stale entries (lint)
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { boundaryFiles, boundaryIgnores } from "./coverage.mjs";
import {
  describe,
  diffExceptions,
  exceptionsFile,
  loadExceptions,
  sortEntries,
  writeExceptions,
} from "./exceptions.mjs";
import { boundaryPlugin } from "./plugin.mjs";
import { collectSqlViolations, formatSqlViolation } from "./sql-ownership.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const LAYER_MESSAGE = /\[([a-z0-9-]+) -> (.+)\]$/;

/** Every layer violation, ignoring the recorded exceptions; plus hard errors. */
export async function collectLayerViolations(cwd = root) {
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [
      { ignores: boundaryIgnores },
      {
        files: boundaryFiles,
        languageOptions: { parser: tseslint.parser },
        plugins: { boundaries: boundaryPlugin },
        rules: { "boundaries/imports": ["error", { collect: true }] },
      },
    ],
  });
  const results = await eslint.lintFiles(boundaryFiles);
  const entries = new Map();
  const errors = [];
  for (const result of results) {
    const file = path.relative(cwd, result.filePath).replaceAll("\\", "/");
    for (const message of result.messages) {
      const match = LAYER_MESSAGE.exec(message.message);
      if (match && message.ruleId === "boundaries/imports")
        entries.set(`${match[1]}\0${file}\0${match[2]}`, {
          rule: match[1],
          file,
          target: match[2],
        });
      else errors.push(`${file}:${message.line} ${message.message}`);
    }
  }
  return { entries: [...entries.values()], errors };
}
export function summarise(entries) {
  const counts = {};
  for (const entry of entries) {
    const key =
      entry.rule === "sql-owner"
        ? `sql-owner (${entry.owner ?? "?"})`
        : entry.rule;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
export async function collectAll(cwd = root) {
  const layers = await collectLayerViolations(cwd);
  const sql = collectSqlViolations(cwd);
  return {
    errors: layers.errors,
    sql,
    entries: [
      ...layers.entries,
      ...sql.map(({ rule, file, table }) => ({ rule, file, table })),
    ],
  };
}
async function main(mode) {
  const { entries, errors, sql } = await collectAll();
  if (errors.length) {
    for (const line of errors) console.error(line);
    console.error(
      `${errors.length} boundary error(s) that cannot be excepted.`,
    );
    process.exitCode = 1;
  }
  const recorded = loadExceptions();
  if (mode === "--write") {
    writeExceptions(entries);
    const { added, stale } = diffExceptions(entries, recorded);
    console.log(
      `exceptions.json: ${entries.length} entries (${added.length} added, ${stale.length} removed)`,
    );
    const owners = new Map(sql.map((v) => [`${v.file}\0${v.table}`, v.owner]));
    console.log(
      JSON.stringify(
        summarise(
          sortEntries(entries).map((e) =>
            e.rule === "sql-owner"
              ? { ...e, owner: owners.get(`${e.file}\0${e.table}`) }
              : e,
          ),
        ),
        null,
        2,
      ),
    );
    return;
  }
  const { added, stale } = diffExceptions(entries, recorded);
  const byKey = new Map(sql.map((v) => [`${v.file}\0${v.table}`, v]));
  for (const entry of added) {
    const sqlViolation = byKey.get(`${entry.file}\0${entry.table}`);
    console.error(
      sqlViolation && entry.rule === "sql-owner"
        ? `new violation ${formatSqlViolation(sqlViolation)}`
        : `new violation ${describe(entry)}`,
    );
  }
  for (const entry of stale)
    console.error(`stale exception (remove it): ${describe(entry)}`);
  if (added.length || stale.length) {
    console.error(
      `${added.length} new, ${stale.length} stale. Fix the code, or after intended moves run: node tools/boundaries/ratchet.mjs --write`,
    );
    process.exitCode = 1;
  }
  if (!process.exitCode)
    console.log(
      `boundaries: ${recorded.length} recorded exceptions, none new, none stale`,
    );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    console.error("usage: ratchet.mjs --write | --check");
    process.exit(2);
  }
  await main(mode);
}
export { exceptionsFile };
