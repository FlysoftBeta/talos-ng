import { readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { join } from "node:path";

const FRAME =
  /^(\s*at\s+)(.*?)\(?(?:https?|file):\/\/[^\s()]*?\/([^/\s()?#]+\.js):(\d+):(\d+)\)?$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Restores minified frames while an incident is recorded, so stored stacks are already readable.
 * Layout: `<dir>/<build>/<bundle>.js.map` for client bundles, `<dir>/server.js.map` for this server.
 */
export class SourceMaps {
  private readonly cache = new Map<string, SourceMap | null>();
  constructor(
    private readonly directory: string,
    private readonly build: string,
  ) {}
  private load(file: string): SourceMap | null {
    if (!this.cache.has(file)) {
      let map: SourceMap | null = null;
      try {
        map = new SourceMap(JSON.parse(readFileSync(file, "utf8")));
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
        // Frame positions are 1-based; SourceMap is 0-based.
        const hit = (
          file
            ? this.load(file)?.findEntry(Number(m[4]) - 1, Number(m[5]) - 1)
            : undefined
        ) as
          | {
              originalSource?: string;
              originalLine: number;
              originalColumn: number;
              name?: string;
            }
          | undefined;
        return hit?.originalSource
          ? `${m[1]}${m[2]!.trim() || hit.name || "<anonymous>"} (${hit.originalSource}:${hit.originalLine + 1}:${hit.originalColumn + 1})`
          : line;
      })
      .join("\n");
  }
}
