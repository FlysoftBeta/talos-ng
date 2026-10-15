import { StringDecoder } from "node:string_decoder";
/** Redacts the first-boot credential even when UTF-8 or a PIN line spans pipe chunks. */
export class ChildLogOutput {
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";
  private dropping = false;
  constructor(private readonly write: (line: string) => void) {}
  push(bytes: Uint8Array): void {
    this.buffer += this.decoder.write(Buffer.from(bytes));
    for (;;) {
      const end = this.buffer.indexOf("\n");
      if (end < 0) break;
      const line = this.buffer.slice(0, end + 1);
      this.buffer = this.buffer.slice(end + 1);
      if (!this.dropping) this.emit(line);
      this.dropping = false;
    }
    if (this.buffer.length > 65536) {
      this.buffer = "";
      this.dropping = true;
      this.write("[启动器：过长输出行已省略]\n");
    }
  }
  end(): void {
    this.buffer += this.decoder.end();
    if (this.buffer && !this.dropping) this.emit(this.buffer);
    this.buffer = "";
  }
  private emit(line: string): void {
    this.write(line.replace(/(首次启动 PIN:)\s*\d{6}/g, "$1 [redacted]"));
  }
}
