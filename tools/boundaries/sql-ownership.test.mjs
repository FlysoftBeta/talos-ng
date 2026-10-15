import { describe, expect, it } from "vitest";
import {
  checkFile,
  collectSqlViolations,
  DYNAMIC,
  extractTables,
  openViolations,
  UNSUPPORTED,
} from "./sql-ownership.mjs";
import { sqlOwners } from "./sql-owners.mjs";
import { fileURLToPath } from "node:url";

const owners = {
  a: { paths: ["m/a/"], tables: ["a_rows", "a_other"] },
  b: { paths: ["m/b/"], tables: ["b_rows"] },
};
const tables = (sql) => extractTables(sql).map((ref) => ref.table);
const check = (code, file = "m/a/repo.ts", gateways = []) =>
  checkFile(file, code, { owners, gateways }).map(
    (v) => `${v.table}:${v.owner}`,
  );

describe("table extraction", () => {
  it("reads joins, comma lists, sub-queries and CTEs", () => {
    expect(
      tables("SELECT 1 FROM a_rows r LEFT JOIN b_rows b ON b.id=r.id, a_other"),
    ).toEqual(["a_rows", "b_rows", "a_other"]);
    expect(
      tables(
        "SELECT (SELECT count(*) FROM b_rows x WHERE x.id=r.id) n, r.id FROM a_rows r",
      ),
    ).toEqual(["b_rows", "a_rows"]);
    expect(
      tables(
        "WITH t AS (SELECT id FROM a_rows), u(x) AS (SELECT 1) SELECT * FROM t JOIN u",
      ),
    ).toEqual(["a_rows"]);
    expect(
      tables(
        "SELECT a, b FROM a_rows WHERE id IN (SELECT id FROM b_rows) ORDER BY a, b",
      ),
    ).toEqual(["a_rows", "b_rows"]);
  });
  it("reads DML, DDL, triggers and pragmas; ignores table functions and system tables", () => {
    expect(
      tables(
        'INSERT INTO "a_rows"(id) VALUES(1) ON CONFLICT(id) DO UPDATE SET id=2',
      ),
    ).toEqual(["a_rows"]);
    expect(
      tables("UPDATE OR REPLACE b_rows SET x=1 FROM a_rows WHERE 1"),
    ).toEqual(["b_rows", "a_rows"]);
    expect(tables("DELETE FROM `a_rows` WHERE id=1")).toEqual(["a_rows"]);
    expect(
      tables(
        "CREATE TABLE IF NOT EXISTS main.a_rows(id TEXT REFERENCES b_rows(id)); CREATE UNIQUE INDEX i ON a_rows(id)",
      ),
    ).toEqual(["a_rows", "a_rows"]);
    expect(
      tables(
        "ALTER TABLE a_rows ADD COLUMN x TEXT; DROP TABLE IF EXISTS a_other",
      ),
    ).toEqual(["a_rows", "a_other"]);
    expect(
      tables(
        "CREATE TRIGGER t BEFORE UPDATE OF id ON a_rows BEGIN SELECT RAISE(ABORT,'x'); END;",
      ),
    ).toEqual(["a_rows"]);
    expect(tables("PRAGMA table_info(a_rows)")).toEqual(["a_rows"]);
    expect(
      tables("SELECT value FROM a_rows, json_each(a_rows.body) WHERE 1"),
    ).toEqual(["a_rows"]);
    expect(tables("SELECT name FROM sqlite_master WHERE type='table'")).toEqual(
      [],
    );
  });
  it("fails closed on interpolated and unreadable table positions", () => {
    expect(tables("SELECT 1 FROM ")).toEqual([DYNAMIC]);
    expect(tables("SELECT 1 FROM chat_")).toEqual([DYNAMIC]);
    expect(tables("SELECT 1 FROM a_rows WHERE 1")).toEqual(["a_rows"]);
    expect(tables("SELECT 1 FROM other.a_rows")).toEqual([UNSUPPORTED]);
    expect(tables("SELECT 1 FROM 5")).toEqual([UNSUPPORTED]);
  });
});

describe("ownership gate", () => {
  it("accepts own tables and rejects foreign tables, also in joins and sub-queries", () => {
    expect(check('db.get("SELECT * FROM a_rows")')).toEqual([]);
    expect(
      check('db.all("SELECT * FROM a_rows r JOIN b_rows b ON b.id=r.id")'),
    ).toEqual(["b_rows:b"]);
    expect(
      check(
        'db.all(`SELECT id FROM a_rows WHERE id IN (SELECT id FROM "b_rows")`)',
      ),
    ).toEqual(["b_rows:b"]);
    expect(check("db.exec(`WITH x AS (SELECT 1) SELECT * FROM x`)")).toEqual(
      [],
    );
    expect(check('db.get("SELECT * FROM a_rows")', "m/b/repo.ts")).toEqual([
      "a_rows:a",
    ]);
    expect(check('db.get("SELECT * FROM a_rows")', "m/app/x.ts")).toEqual([
      "a_rows:a",
    ]);
  });
  it("rejects interpolated tables unless the file is a named gateway", () => {
    const code = "db.exec(`DELETE FROM ${table} WHERE 1`)";
    expect(check(code)).toEqual([`${DYNAMIC}:dynamic`]);
    expect(
      check(code, "m/a/repo.ts", [{ file: "m/a/repo.ts", reason: "snapshot" }]),
    ).toEqual([]);
    expect(check("db.run(`SELECT 1 FROM a_rows${where}`)")).toEqual([]);
    expect(check("db.run(`UPDATE a_rows SET ${column}=? WHERE id=?`)")).toEqual(
      [],
    );
  });
  it("rejects unknown tables and reads concatenated literals", () => {
    expect(check('db.get("SELECT * FROM mystery")')).toEqual([
      "mystery:unknown",
    ]);
    expect(check('db.get("SELECT * FROM " + "b_rows")')).toEqual(["b_rows:b"]);
    expect(
      check(
        'db.get("SELECT * FROM a_rows WHERE " + clause + " AND x IN (SELECT 1 FROM b_rows)")',
      ),
    ).toEqual(["b_rows:b"]);
    expect(check('throw new Error("Select from the list of updates")')).toEqual(
      [],
    );
    expect(check('import x from "SELECT * FROM mystery";')).toEqual([]);
  });
  it("accepts a foreign table only with an exact recorded exception", () => {
    const found = checkFile(
      "m/a/repo.ts",
      'db.get("SELECT * FROM b_rows")\ndb.get("SELECT 1 FROM b_rows")',
      { owners },
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      file: "m/a/repo.ts",
      table: "b_rows",
      line: 1,
    });
    expect(openViolations(found, [])).toHaveLength(1);
    expect(
      openViolations(found, [
        { rule: "sql-owner", file: "m/a/repo.ts", table: "b_rows" },
      ]),
    ).toEqual([]);
    expect(
      openViolations(found, [
        { rule: "sql-owner", file: "m/a/other.ts", table: "b_rows" },
      ]),
    ).toHaveLength(1);
  });
});

describe("the repository", () => {
  it("assigns every table once and finds statements in server sources", () => {
    const all = Object.values(sqlOwners).flatMap((owner) => owner.tables);
    expect(new Set(all).size).toBe(all.length);
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const violations = collectSqlViolations(root);
    // Purge coordination and participants never reach across table owners.
    expect(violations.filter((v) => v.file.includes("purge"))).toEqual([]);
    expect(
      violations.filter((v) =>
        ["unknown", "dynamic", "unsupported"].includes(v.owner),
      ),
    ).toEqual([]);
  });
});
