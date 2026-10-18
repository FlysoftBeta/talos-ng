import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

const FRAME =
  /^(\s*at\s+)(.*?)\(?(?:https?|file):\/\/[^\s()]*?\/([^/\s()?#]+\.js):(\d+):(\d+)\)?$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Restores minified frames while an incident is recorded, so stored stacks are already readable.
 * Layout: `<dir>/<build>/<bundle>.js.map` for client bundles, `<dir>/server.js.map` for this server.
 */
export class TraceMaps {
  private readonly cache = new Map<string, TraceMap | null>();
  constructor(
    private readonly directory: string,
    private readonly build: string,
  ) {}
  private load(file: string): TraceMap | null {
    if (!this.cache.has(file)) {
      let map: TraceMap | null = null;
      try {
        map = new TraceMap(JSON.parse(readFileSync(file, "utf8")));
      } catch {
        // No map for this build: the frame stays minified.
      }
      this.cache.set(file, map);
    }
    return this.cache.get(file)!;
  }
  restore(stack: string, source: "client" | "server", build: string): string {
    if (source === "client" && !SAFE.test(build)) return stack;
    return stack
      .split("\n")
      .map((line) => {
        const m = FRAME.exec(line);
        if (!m || !SAFE.test(m[3]!)) return line;
        const file =
          source === "server"
            ? m[3] === "server.js" && build === this.build
              ? join(this.directory, "server.js.map")
              : undefined
            : join(this.directory, build, `${m[3]}.map`);
        // Frame columns are 1-based; trace-mapping columns are 0-based.
        const hit = file
          ? this.load(file) &&
            originalPositionFor(this.load(file)!, {
              line: Number(m[4]),
              column: Number(m[5]) - 1,
            })
          : undefined;
        return hit?.source
          ? `${m[1]}${m[2]!.trim() || hit.name || "<anonymous>"} (${hit.source}:${hit.line!}:${hit.column! + 1})`
          : line;
      })
      .join("\n");
  }
}
