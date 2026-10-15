// B4: SQL table ownership. Statements are found in string/template literals via
// the TypeScript AST and read by a bounded tokenizer for the SQL used here
// (SELECT/INSERT/UPDATE/DELETE/WITH, CREATE/ALTER/DROP TABLE|INDEX|TRIGGER,
// PRAGMA table_info-style calls, joins, sub-queries, CTEs, quoted identifiers,
// schema prefixes). REFERENCES (foreign keys) are integrity declarations, not
// data access, and are not checked. Table functions (json_each, pragma_*) and
// sqlite_* system tables are ignored. A table position that is interpolated or
// that the tokenizer cannot read is a violation, never silently accepted.
// Not covered: SQL assembled across statements or functions at run time.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  dynamicTableGateways,
  offlineSqlDirectories,
  scanRoot,
  sqlOwners,
} from "./sql-owners.mjs";
import { exceptionKey, loadExceptions } from "./exceptions.mjs";

const HOLE = "";
export const DYNAMIC = "<dynamic>";
export const UNSUPPORTED = "<unsupported>";
const STATEMENT_START =
  /^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(?:SELECT\b[\s\S]*\bFROM\b|SELECT\s+(?:\d|\*|\w+\s*\()|(?:INSERT\s+(?:OR\s+\w+\s+)?|REPLACE\s+)INTO\b|UPDATE\s+(?:OR\s+\w+\s+)?\S+\s+SET\b|DELETE\s+FROM\b|WITH\s+(?:RECURSIVE\s+)?\S+\s+(?:\([^)]*\)\s*)?AS\b|CREATE\s+(?:(?:TEMP|TEMPORARY|UNIQUE|VIRTUAL)\s+)*(?:TABLE|INDEX|TRIGGER|VIEW)\b|ALTER\s+TABLE\b|DROP\s+(?:TABLE|INDEX|TRIGGER|VIEW)\b|PRAGMA\s+\w+\s*\()/;
// Statements are recognised by upper-case keywords (all repository SQL is). A
// lower-case DML/DDL statement is reported rather than silently skipped.
const LOWERCASE_START =
  /^\s*(?:insert\s+into|delete\s+from|create\s+table|alter\s+table|drop\s+table|update\s+\S+\s+set)\b/;
const CLAUSE_END = new Set([
  "WHERE",
  "GROUP",
  "HAVING",
  "ORDER",
  "LIMIT",
  "WINDOW",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "SET",
  "RETURNING",
  "VALUES",
  "SELECT",
]);
const TABLE_PRAGMAS = new Set([
  "table_info",
  "table_xinfo",
  "table_list",
  "foreign_key_list",
  "index_list",
  "index_info",
  "index_xinfo",
]);
const SKIP_AFTER_UPDATE = new Set([
  "SET",
  "OF",
  "ON",
  "CASCADE",
  "RESTRICT",
  "NO",
]);

function tokenize(text, baseLine) {
  const tokens = [];
  let line = baseLine;
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (char === "\n") {
      line++;
      i++;
    } else if (/\s/.test(char)) i++;
    else if (char === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      line += (text.slice(i, stop).match(/\n/g) ?? []).length;
      i = stop;
    } else if (/[A-Za-z_]/.test(char)) {
      let j = i + 1;
      while (j < text.length && /[A-Za-z0-9_$]/.test(text[j])) j++;
      const value = text.slice(i, j);
      tokens.push({
        type: "word",
        value,
        upper: value.toUpperCase(),
        line,
        gap: i > 0 && !/\s/.test(text[i - 1]) ? 0 : 1,
      });
      i = j;
    } else if (char === '"' || char === "`" || char === "[" || char === "'") {
      const close = char === "[" ? "]" : char;
      let j = i + 1;
      let value = "";
      while (j < text.length) {
        if (text[j] === close) {
          if (close !== "]" && text[j + 1] === close) {
            value += close;
            j += 2;
            continue;
          }
          break;
        }
        if (text[j] === "\n") line++;
        value += text[j++];
      }
      tokens.push({
        type: char === "'" ? "string" : "quoted",
        value,
        upper: value.toUpperCase(),
        line,
      });
      i = j + 1;
    } else if (char === HOLE) {
      tokens.push({
        type: "hole",
        value: HOLE,
        line,
        gap: i > 0 && !/\s/.test(text[i - 1]) ? 0 : 1,
      });
      i++;
    } else if (/[0-9]/.test(char)) {
      let j = i + 1;
      while (j < text.length && /[0-9A-Za-z_.]/.test(text[j])) j++;
      tokens.push({ type: "num", value: text.slice(i, j), line });
      i = j;
    } else {
      tokens.push({ type: "punct", value: char, line });
      i++;
    }
  }
  return tokens;
}
function skipBalanced(tokens, open) {
  let depth = 0;
  for (let j = open; j < tokens.length; j++) {
    if (tokens[j].value === "(" && tokens[j].type === "punct") depth++;
    else if (
      tokens[j].value === ")" &&
      tokens[j].type === "punct" &&
      --depth === 0
    )
      return j + 1;
  }
  return tokens.length;
}
const isPunct = (token, value) =>
  token?.type === "punct" && token.value === value;
const isWord = (token, upper) =>
  token?.type === "word" && token.upper === upper;
const isName = (token) => token?.type === "word" || token?.type === "quoted";

function commonTableExpressions(tokens) {
  const names = new Set();
  tokens.forEach((token, i) => {
    const previous = tokens[i - 1];
    if (!isWord(token, "WITH")) return;
    if (
      previous &&
      !isPunct(previous, ";") &&
      !isPunct(previous, "(") &&
      !isWord(previous, "AS") &&
      !isWord(previous, "BEGIN")
    )
      return;
    let j = i + 1;
    if (isWord(tokens[j], "RECURSIVE")) j++;
    for (;;) {
      if (!isName(tokens[j])) return;
      names.add(tokens[j].value.toLowerCase());
      j++;
      if (isPunct(tokens[j], "(")) j = skipBalanced(tokens, j);
      if (!isWord(tokens[j], "AS")) return;
      j++;
      if (isWord(tokens[j], "NOT")) j++;
      if (isWord(tokens[j], "MATERIALIZED")) j++;
      if (!isPunct(tokens[j], "(")) return;
      j = skipBalanced(tokens, j);
      if (!isPunct(tokens[j], ",")) return;
      j++;
    }
  });
  return names;
}

/** Table references of one SQL text: [{table, line}] (table may be DYNAMIC/UNSUPPORTED). */
export function extractTables(text, baseLine = 1) {
  const tokens = tokenize(text, baseLine);
  const ctes = commonTableExpressions(tokens);
  const refs = [];
  const fromLists = [false];
  // `call` is true in FROM/JOIN position, where `name(` is a table function.
  function table(at, call) {
    let j = at;
    if (isWord(tokens[j], "IF")) {
      j++;
      if (isWord(tokens[j], "NOT")) j++;
      if (isWord(tokens[j], "EXISTS")) j++;
    }
    const first = tokens[j];
    if (!first || isPunct(first, "(")) return;
    if (first.type === "hole")
      return void refs.push({ table: DYNAMIC, line: first.line });
    if (
      !isName(first) ||
      (first.type === "word" &&
        ["SELECT", "WITH", "VALUES"].includes(first.upper))
    )
      return void refs.push({ table: UNSUPPORTED, line: first.line });
    let name = first;
    if (isPunct(tokens[j + 1], ".") && isName(tokens[j + 2])) {
      if (!["main", "temp"].includes(first.value.toLowerCase()))
        return void refs.push({ table: UNSUPPORTED, line: first.line });
      name = tokens[j + 2];
      j += 2;
    }
    const next = tokens[j + 1];
    if (call && isPunct(next, "(")) return;
    if (next?.type === "hole" && next.gap === 0 && name.value.endsWith("_"))
      return void refs.push({ table: DYNAMIC, line: name.line });
    const lower = name.value.toLowerCase();
    if (
      ctes.has(lower) ||
      lower.startsWith("sqlite_") ||
      lower.startsWith("pragma_")
    )
      return;
    refs.push({ table: lower, line: name.line });
  }
  tokens.forEach((token, i) => {
    const previous = tokens[i - 1];
    const next = tokens[i + 1];
    if (token.type === "punct") {
      if (token.value === "(") fromLists.push(false);
      else if (token.value === ")") fromLists.pop();
      else if (token.value === ";") fromLists[fromLists.length - 1] = false;
      else if (token.value === "," && fromLists[fromLists.length - 1])
        table(i + 1, true);
      return;
    }
    if (token.type !== "word") return;
    const word = token.upper;
    if (CLAUSE_END.has(word)) fromLists[fromLists.length - 1] = false;
    if (word === "FROM" && !isWord(previous, "DISTINCT")) {
      fromLists[fromLists.length - 1] = true;
      table(i + 1, true);
    } else if (word === "JOIN") table(i + 1, true);
    else if (word === "INTO") table(i + 1, false);
    else if (word === "UPDATE") {
      if (isWord(previous, "DO") || isWord(previous, "ON")) return;
      if (next?.type === "word" && SKIP_AFTER_UPDATE.has(next.upper)) return;
      table(isWord(next, "OR") ? i + 3 : i + 1, false);
    } else if (
      word === "TABLE" &&
      ["CREATE", "ALTER", "DROP", "TEMP", "TEMPORARY", "VIRTUAL"].includes(
        previous?.upper ?? "",
      )
    )
      table(i + 1, false);
    else if (
      word === "INDEX" &&
      ["CREATE", "UNIQUE"].includes(previous?.upper ?? "")
    ) {
      let j = i + 1;
      while (j < tokens.length && !isWord(tokens[j], "ON")) j++;
      if (j < tokens.length) table(j + 1, false);
    } else if (
      word === "TRIGGER" &&
      ["CREATE", "TEMP", "TEMPORARY"].includes(previous?.upper ?? "")
    ) {
      let j = i + 1;
      while (j < tokens.length && !isWord(tokens[j], "ON")) j++;
      if (j < tokens.length) table(j + 1, false);
    } else if (
      word === "PRAGMA" &&
      next?.type === "word" &&
      TABLE_PRAGMAS.has(next.value.toLowerCase()) &&
      isPunct(tokens[i + 2], "(")
    ) {
      const arg = tokens[i + 3];
      if (arg?.type === "string" || isName(arg))
        refs.push({ table: arg.value.toLowerCase(), line: arg.line });
    }
  });
  return refs;
}

/** String-like expressions: {text, children} where holes stand for ${...}. */
function stringUnit(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return { text: node.text, children: [] };
  if (ts.isParenthesizedExpression(node)) return stringUnit(node.expression);
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) text += HOLE + span.literal.text;
    return {
      text,
      children: node.templateSpans.map((span) => span.expression),
    };
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = stringUnit(node.left);
    const right = stringUnit(node.right);
    if (!left && !right) return;
    return {
      text: (left?.text ?? HOLE) + (right?.text ?? HOLE),
      children: [
        ...(left ? left.children : [node.left]),
        ...(right ? right.children : [node.right]),
      ],
    };
  }
}
/** SQL statements found in a source file: [{table, line}] in source order. */
export function scanSource(fileName, sourceText) {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const refs = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    const unit = stringUnit(node);
    if (unit) {
      const segments = unit.text.split(";");
      if (segments.some((segment) => LOWERCASE_START.test(segment))) {
        const line =
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        refs.push({ table: UNSUPPORTED, line });
      }
      if (segments.some((segment) => STATEMENT_START.test(segment))) {
        const line =
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        refs.push(...extractTables(unit.text, line));
      }
      unit.children.forEach(visit);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return refs;
}

export function ownerOfFile(file, owners = sqlOwners) {
  for (const [name, owner] of Object.entries(owners))
    if (
      owner.paths.some((p) =>
        p.endsWith("/") ? file.startsWith(p) : file === p,
      )
    )
      return name;
  return null;
}
function tableOwners(owners) {
  const map = new Map();
  for (const [name, owner] of Object.entries(owners))
    for (const table of owner.tables) map.set(table, name);
  return map;
}
/** Ownership violations of one file's references; one entry per (file, table). */
export function checkFile(
  file,
  text,
  { owners = sqlOwners, gateways = dynamicTableGateways } = {},
) {
  const fileOwner = ownerOfFile(file, owners);
  const byTable = tableOwners(owners);
  const found = new Map();
  for (const { table, line } of scanSource(file, text)) {
    let owner;
    if (table === DYNAMIC) {
      if (gateways.some((g) => g.file === file)) continue;
      owner = "dynamic";
    } else if (table === UNSUPPORTED) owner = "unsupported";
    else {
      owner = byTable.get(table);
      if (owner !== undefined && owner === fileOwner) continue;
      owner ??= "unknown";
    }
    if (!found.has(table))
      found.set(table, {
        rule: "sql-owner",
        file,
        table,
        line,
        owner,
        fileOwner,
      });
  }
  return [...found.values()];
}
/** Violations not covered by a recorded {rule: "sql-owner", file, table} entry. */
export function openViolations(violations, exceptions) {
  const allowed = new Set(exceptions.map(exceptionKey));
  return violations.filter((v) => !allowed.has(exceptionKey(v)));
}
export function formatSqlViolation(v) {
  return `${v.file}:${v.line} ${v.table} ${v.owner}`;
}
const TEST_PATH = /(?:\.test\.|\.d\.ts$|(?:^|\/)(?:tests|testing)\/)/;
function walk(directory, base, out) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = `${directory}/${entry.name}`;
    if (entry.isDirectory()) walk(full, `${base}${entry.name}/`, out);
    else if (/\.(?:ts|tsx|mts)$/.test(entry.name))
      out.push(`${base}${entry.name}`);
  }
}
/** All ownership violations in non-test server sources (before exceptions). */
export function collectSqlViolations(cwd) {
  const files = [];
  walk(path.join(cwd, scanRoot).replace(/\/$/, ""), scanRoot, files);
  return files
    .filter((file) => !TEST_PATH.test(file))
    .sort()
    .flatMap((file) =>
      checkFile(file, readFileSync(path.join(cwd, file), "utf8")),
    );
}
export { offlineSqlDirectories };

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  // Standalone check of SQL ownership only; ratchet.mjs --check is the full gate.
  const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
  const open = openViolations(collectSqlViolations(root), loadExceptions());
  for (const v of open) console.error(formatSqlViolation(v));
  if (open.length) process.exitCode = 1;
}
