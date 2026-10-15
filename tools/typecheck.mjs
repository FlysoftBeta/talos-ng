// TypeScript 7's compiler and TypeScript 6's ESLint API must coexist for now.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const compiler = fileURLToPath(
  new URL("../node_modules/typescript7/bin/tsc", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [compiler, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
