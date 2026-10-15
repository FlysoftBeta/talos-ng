import { AppError } from "@talos/base";
const PIXELS = 32_000_000;
function dimensions(width: number, height: number): void {
  if (
    !width ||
    !height ||
    width > 32768 ||
    height > 32768 ||
    width * height > PIXELS
  )
    throw new AppError("E_TOO_LARGE", "图片像素过多或尺寸无效");
}
/** Inspect compressed headers before allocating a decoder bitmap. */
export function validateImageBounds(bytes: Uint8Array, mime: string): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = (): never => {
    throw new AppError("E_INVALID", "图片头部损坏");
  };
  if (mime === "image/png") {
    if (bytes.length < 24) invalid();
    dimensions(view.getUint32(16), view.getUint32(20));
    return;
  }
  if (mime === "image/bmp") {
    if (bytes.length < 26) invalid();
    const dib = view.getUint32(14, true);
    dimensions(
      dib === 12 ? view.getUint16(18, true) : Math.abs(view.getInt32(18, true)),
      dib === 12 ? view.getUint16(20, true) : Math.abs(view.getInt32(22, true)),
    );
    return;
  }
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]!;
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) invalid();
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length) invalid();
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      ) {
        if (size < 7) invalid();
        dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
        return;
      }
      offset += size;
    }
    invalid();
  }
  if (mime === "image/gif") {
    if (bytes.length < 13) invalid();
    const width = view.getUint16(6, true),
      height = view.getUint16(8, true);
    dimensions(width, height);
    let offset = 13;
    if (bytes[10]! & 128) offset += 3 * (1 << ((bytes[10]! & 7) + 1));
    let frames = 0;
    let totalPixels = 0;
    const blocks = (): void => {
      while (offset < bytes.length) {
        const size = bytes[offset++]!;
        if (!size) return;
        offset += size;
      }
      invalid();
    };
    while (offset < bytes.length) {
      const marker = bytes[offset++]!;
      if (marker === 59) return;
      if (marker === 33) {
        offset++;
        blocks();
        continue;
      }
      if (marker !== 44 || offset + 9 > bytes.length) invalid();
      frames++;
      const frameWidth = view.getUint16(offset + 4, true);
      const frameHeight = view.getUint16(offset + 6, true);
      totalPixels += Math.max(width * height, frameWidth * frameHeight);
      if (frames > 512 || totalPixels > PIXELS)
        throw new AppError("E_TOO_LARGE", "动图总像素过多");
      const packed = bytes[offset + 8]!;
      dimensions(
        view.getUint16(offset + 4, true),
        view.getUint16(offset + 6, true),
      );
      offset += 9;
      if (packed & 128) offset += 3 * (1 << ((packed & 7) + 1));
      offset++;
      blocks();
    }
    invalid();
  }
}
