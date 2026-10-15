import sharp from "sharp";
import { expect, it } from "vitest";
import { decodeBmp } from "./bmp.ts";

function bmp24(width: number, height: number, bottomUp: boolean): Uint8Array {
  const stride = Math.ceil((width * 24) / 32) * 4;
  const out = Buffer.alloc(54 + stride * height);
  out.write("BM");
  out.writeUInt32LE(out.length, 2);
  out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14);
  out.writeInt32LE(width, 18);
  out.writeInt32LE(bottomUp ? height : -height, 22);
  out.writeUInt16LE(1, 26);
  out.writeUInt16LE(24, 28);
  // Pixel (x, y): blue = x, green = y, red = 200 (with row padding between rows).
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const row = bottomUp ? height - 1 - y : y;
      const at = 54 + row * stride + x * 3;
      out[at] = x;
      out[at + 1] = y;
      out[at + 2] = 200;
    }
  return out;
}

it("decodes padded bottom-up and top-down 24-bit BMP rows into RGBA", async () => {
  for (const bottomUp of [true, false]) {
    const decoded = decodeBmp(bmp24(3, 2, bottomUp));
    expect([decoded.width, decoded.height]).toEqual([3, 2]);
    expect([...decoded.data.subarray(0, 4)]).toEqual([200, 0, 0, 255]);
    expect([...decoded.data.subarray(20, 24)]).toEqual([200, 1, 2, 255]);
    const jpeg = await sharp(decoded.data, {
      raw: { width: 3, height: 2, channels: 4 },
    })
      .jpeg()
      .toBuffer();
    expect(jpeg.length).toBeGreaterThan(0);
  }
});

it("rejects compressed and truncated BMP files", () => {
  const rle = Buffer.from(bmp24(2, 2, true));
  rle.writeUInt32LE(1, 30);
  expect(() => decodeBmp(rle)).toThrow("BMP");
  expect(() => decodeBmp(bmp24(8, 8, true).subarray(0, 100))).toThrow();
});
