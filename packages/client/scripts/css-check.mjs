// Lints every authored stylesheet of the client for CSS that Chrome 70 does not support.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../src", import.meta.url));
const unsafe =
  /(?:^|[;{\s])(?:gap|row-gap|column-gap|inset|aspect-ratio|backdrop-filter)\s*:|\b(?:clamp|min|max)\s*\(|:(?:is|where|focus-visible|has)\s*\(?|overflow-wrap\s*:\s*anywhere/i;
const failures = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (name.endsWith(".css")) {
      const source = readFileSync(file, "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        (c) => c.replace(/[^\n]/g, " "),
      );
      source.split("\n").forEach((line, index) => {
        if (unsafe.test(line))
          failures.push(
            `${path.relative(root, file)}:${index + 1}: ${line.trim()}`,
          );
      });
    }
  }
}
walk(root);
if (failures.length) {
  process.stderr.write(
    "Unsupported Chrome 70 CSS:\n" + failures.join("\n") + "\n",
  );
  process.exit(1);
}
