// Restores minified frames in a diagnostics export using the maps published with a release.
// Usage: node tools/sourcemap/restore.mjs <diagnostics.json> <source-maps-dir>
// <source-maps-dir> holds <build>/<file>.map (client bundles) and <build>/server.js.map,
// i.e. the unpacked talos-sourcemaps.zip release asset or CI artifact.
import { readFile } from "node:fs/promises";
import { SourceMap } from "node:module";
import path from "node:path";

const [diagnostics, mapsDir] = process.argv.slice(2);
if (!diagnostics || !mapsDir) {
  console.error("usage: restore.mjs <diagnostics.json> <source-maps-dir>");
  process.exit(2);
}
const cache = new Map();
async function load(build, file) {
  const key = `${build}/${file}`;
  if (!cache.has(key)) {
    let map = null;
    try {
      map = new SourceMap(
        JSON.parse(
          await readFile(path.join(mapsDir, build, `${file}.map`), "utf8"),
        ),
      );
    } catch {}
    cache.set(key, map);
  }
  return cache.get(key);
}
const frame =
  /^(\s*at\s+)(.*?)\(?((?:https?|file):\/\/[^\s()]*?([^/\s()]+\.js)):(\d+):(\d+)\)?$/;
async function restore(build, stack) {
  const out = [];
  for (const line of stack.split("\n")) {
    const m = frame.exec(line);
    const map = m && (await load(build, m[4]));
    // Frame positions are 1-based; SourceMap is 0-based.
    const hit = map?.findEntry(Number(m[5]) - 1, Number(m[6]) - 1);
    out.push(
      hit?.originalSource
        ? `${m[1]}${m[2].trim() || hit.name || "<anonymous>"} (${hit.originalSource}:${hit.originalLine + 1}:${hit.originalColumn + 1})`
        : `${line}  [no map]`,
    );
  }
  return out.join("\n");
}
const data = JSON.parse(await readFile(diagnostics, "utf8"));
for (const incident of data.incidents ?? []) {
  console.log(
    `${incident.summary} ×${incident.count} (${incident.source}, build ${incident.build}, ${incident.id})`,
  );
  console.log(await restore(incident.build, incident.stack));
  console.log();
}
