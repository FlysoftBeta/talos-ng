#!/usr/bin/env node
import { spawnSync } from "node:child_process";
if (!process.execArgv.includes("--experimental-transform-types")) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-transform-types",
      ...process.execArgv,
      import.meta.filename,
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}
try {
  const { main } = await import("../src/main.ts");
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
