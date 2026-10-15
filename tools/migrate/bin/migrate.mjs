#!/usr/bin/env node
import { register } from "tsx/esm/api";

try {
  register();
  const { main } = await import("../src/main.ts");
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
