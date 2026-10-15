// Entry of the release bundle (migrate.js); the repository uses bin/migrate.mjs.
// The release scripts pass --disable-warning=ExperimentalWarning (node:sqlite).
import { main } from "../src/main.ts";

try {
  await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
