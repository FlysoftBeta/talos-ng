import { gzipSync } from "node:zlib";
import { safePath } from "@talos/launcher";
export function tarGz(files: ReadonlyMap<string, Uint8Array>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, bytes] of files) {
    safePath(name);
    const h = Buffer.alloc(512);
    const split = name.lastIndexOf("/");
    if (Buffer.byteLength(name) > 100) {
      if (
        split < 0 ||
        Buffer.byteLength(name.slice(0, split)) > 155 ||
        Buffer.byteLength(name.slice(split + 1)) > 100
      )
        throw new Error("Tar path too long");
      h.write(name.slice(split + 1), 0, 100);
      h.write(name.slice(0, split), 345, 155);
    } else h.write(name, 0, 100);
    const oct = (n: number, width: number) =>
      n.toString(8).padStart(width - 1, "0") + "\0";
    h.write(
      oct(
        name === "start.sh" ||
          name === "runtime/node" ||
          name.endsWith("/pdfrender") ||
          name.endsWith("/yt-dlp")
          ? 0o755
          : 0o644,
        8,
      ),
      100,
    );
    h.write(oct(0, 8), 108);
    h.write(oct(0, 8), 116);
    h.write(oct(bytes.length, 12), 124);
    h.write(oct(0, 12), 136);
    h.fill(32, 148, 156);
    h[156] = 48;
    h.write("ustar\0", 257);
    h.write("00", 263);
    h.write(
      oct(
        h.reduce((a, b) => a + b, 0),
        7,
      ) + " ",
      148,
    );
    chunks.push(
      h,
      Buffer.from(bytes),
      Buffer.alloc((512 - (bytes.length % 512)) % 512),
    );
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
