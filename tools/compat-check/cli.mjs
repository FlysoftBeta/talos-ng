#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkDirectory, validateAllowlist } from "./check.mjs";

const [directory, flag, allowPath, ...extra] = process.argv.slice(2);
if (
  !directory ||
  (flag !== undefined && (flag !== "--allowlist" || !allowPath)) ||
  extra.length
) {
  console.error(
    "Usage: node tools/compat-check/cli.mjs <dir> [--allowlist <file.json>]",
  );
  process.exitCode = 2;
} else {
  try {
    const resolvedAllowPath =
      allowPath ||
      (existsSync(path.join(directory, "compat-allowlist.json"))
        ? path.join(directory, "compat-allowlist.json")
        : undefined);
    const allowlist = resolvedAllowPath
      ? validateAllowlist(JSON.parse(readFileSync(resolvedAllowPath, "utf8")))
      : [];
    const result = checkDirectory(directory, allowlist);
    for (const finding of result.findings)
      console.error(
        `${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`,
      );
    console.log(
      `Checked ${result.files} JS/CSS/HTML files; ${result.findings.length} compatibility violations.`,
    );
    process.exitCode = result.findings.length ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
