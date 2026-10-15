import { AppError } from "@talos/base";

/**
 * libvips (and so sharp's prebuilt binaries) cannot read BMP. Decode the common
 * uncompressed variants (8-bit palette, 24-bit, 32-bit) to RGBA for sharp's raw
 * input; callers validate dimensions with `validateImageBounds` first.
 */
export function decodeBmp(bytes: Uint8Array): {
  data: Buffer;
  width: number;
  height: number;
} {
  const unsupported = (): never => {
    throw new AppError("E_INVALID", "不支持的 BMP 编码");
  };
  if (bytes.length < 54) throw new AppError("E_INVALID", "图片损坏或无法解码");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixelOffset = view.getUint32(10, true);
  const dib = view.getUint32(14, true);
  if (dib < 40) return unsupported();
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const bits = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  if (width <= 0 || !rawHeight || (compression !== 0 && compression !== 3))
    return unsupported();
  if (bits !== 8 && bits !== 24 && bits !== 32) return unsupported();
  const height = Math.abs(rawHeight);
  const stride = Math.ceil((width * bits) / 32) * 4;
  if (pixelOffset + stride * height > bytes.length)
    throw new AppError("E_INVALID", "图片损坏或无法解码");
  const colors = view.getUint32(46, true) || 256;
  const paletteAt = 14 + dib;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const source = pixelOffset + (rawHeight > 0 ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      let b: number, g: number, r: number;
      let a = 255;
      if (bits === 8) {
        const index = bytes[source + x]!;
        if (index >= colors || paletteAt + index * 4 + 3 >= bytes.length)
          throw new AppError("E_INVALID", "图片损坏或无法解码");
        b = bytes[paletteAt + index * 4]!;
        g = bytes[paletteAt + index * 4 + 1]!;
        r = bytes[paletteAt + index * 4 + 2]!;
      } else {
        const at = source + x * (bits / 8);
        b = bytes[at]!;
        g = bytes[at + 1]!;
        r = bytes[at + 2]!;
        // 32-bit BI_RGB carries an unreliable alpha byte; treat it as opaque.
        if (bits === 32 && compression === 3) a = bytes[at + 3]!;
      }
      data[out] = r;
      data[out + 1] = g;
      data[out + 2] = b;
      data[out + 3] = a;
    }
  }
  return { data, width, height };
}
