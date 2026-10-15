/** Synchronous Markdown + math renderer provided by the separately loaded bundle. */
export interface AiRenderer {
  render(text: string): string;
}
/** Retain completed blocks. Only scan newly appended text; a long unfinished paragraph stays plain while streaming. */
export class IncrementalBlocks {
  private previous = "";
  private pending = "";
  private line = "";
  private fence = "";
  private math = false;
  readonly blocks: string[] = [];
  scanned = 0;
  update(
    text: string,
    complete = false,
  ): { blocks: readonly string[]; tail: string } {
    if (!text.startsWith(this.previous)) {
      this.previous = "";
      this.pending = "";
      this.line = "";
      this.fence = "";
      this.math = false;
      this.blocks.length = 0;
    }
    const delta = text.slice(this.previous.length);
    this.previous = text;
    this.scanned += delta.length;
    for (let i = 0; i < delta.length; i++) {
      const c = delta[i]!;
      this.pending += c;
      this.line += c;
      if (c === "\n") {
        const line = this.line.trim();
        const match = /^(```+|~~~+)/.exec(line);
        if (match) {
          if (!this.fence) this.fence = match[1]![0]!;
          else if (match[1]![0] === this.fence) this.fence = "";
        }
        if (line === "$$") this.math = !this.math;
        if (!line && !this.fence && !this.math) {
          this.blocks.push(this.pending);
          this.pending = "";
        }
        this.line = "";
      }
    }
    if (complete && this.pending) {
      this.blocks.push(this.pending);
      this.pending = "";
      this.line = "";
    }
    return { blocks: this.blocks, tail: this.pending };
  }
}
