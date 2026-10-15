import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect } from "vitest";
import { Db } from "../persistence/db.ts";
import { Incidents } from "./incidents.ts";
import { Audit } from "./audit.ts";
import { Logger } from "./log.ts";
it("incidents fingerprint repeats and bound retained rows without persisting secrets", () => {
  const db = new Db();
  let now = 1;
  const incidents = new Incidents(db, () => now++, 2);
  const error = new Error("token TOPSECRET");
  error.stack = "Error: TOPSECRET\n at stable";
  expect(incidents.report(error)).toBe(incidents.report(error));
  expect(incidents.list()[0]?.count).toBe(2);
  incidents.report(new Error("second"), { method: "two" });
  incidents.report(new Error("third"), { method: "three" });
  expect(incidents.list()).toHaveLength(2);
  expect(JSON.stringify(incidents.list())).not.toContain("TOPSECRET");
  db.close();
});
it("audit is append-only in SQL, not just through its API", () => {
  const db = new Db();
  const audit = new Audit(db, () => 10);
  audit.append("user", "test", "target", { count: 1 });
  expect(audit.list()[0]).toMatchObject({
    actor: "user",
    action: "test",
    details: '{"count":1}',
  });
  expect(() => db.run("UPDATE audit SET action='bad'")).toThrow();
  expect(() => db.run("DELETE FROM audit")).toThrow();
  db.close();
});
it("logs filter levels, redact nested secrets and rotate size bounded archives", async () => {
  const directory = await mkdtemp(join(tmpdir(), "talos-log-"));
  const output: string[] = [];
  try {
    const log = new Logger({
      directory,
      maxBytes: 180,
      files: 2,
      now: () => 123,
      console: (line) => output.push(line),
    });
    log.write("debug", "ignored");
    log.write("info", "safe", {
      token: "TOPSECRET",
      nested: { pin: "123456" },
      count: 1,
    });
    expect(output).toHaveLength(1);
    expect(output[0]).not.toContain("TOPSECRET");
    expect(output[0]).not.toContain("123456");
    for (let i = 0; i < 8; i++) log.write("warn", "rotation test " + i);
    expect((await readdir(directory)).sort()).toEqual([
      "server.jsonl",
      "server.jsonl.1",
      "server.jsonl.2",
    ]);
    expect(
      (await readFile(join(directory, "server.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .every((line) => JSON.parse(line).time === 123),
    ).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});

it("protects replay credentials from plaintext storage and rejects tampered results", async () => {
  const { OpResults } = await import("../persistence/op-results.ts");
  const db = new Db();
  const vault = new OpResults(db);
  const value = { token: "very-secret-token", ok: true };
  const encrypted = vault.encode(value);
  expect(encrypted).not.toContain(value.token);
  expect(new OpResults(db).decode(encrypted)).toEqual(value);
  const damaged = JSON.parse(encrypted);
  damaged.data = "AAAA";
  expect(() => vault.decode(JSON.stringify(damaged))).toThrow();
  db.close();
});

it("exports only current-build server log archives with credential redaction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "talos-log-build-"));
  try {
    const old = new Logger({ directory, build: "old", console: () => {} });
    old.write("info", "old-build-only");
    const current = new Logger({
      directory,
      build: "current",
      console: () => {},
      maxBytes: 250,
    });
    current.write("info", "current-start", {
      pin: "123456",
      token: "TOPSECRET",
    });
    current.write("error", "current-error");
    const reloaded = new Logger({
      directory,
      build: "current",
      console: () => {},
    });
    expect(reloaded.snapshot()).toContain("current-start");
    expect(reloaded.snapshot()).toContain("current-error");
    expect(reloaded.snapshot()).not.toMatch(/old-build-only|123456|TOPSECRET/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
