/** A single-entry, stored ZIP for small diagnostic snapshots. */
export function diagnosticZip(name: string, content: Uint8Array): Uint8Array {
  const filename = new TextEncoder().encode(name);
  const crc = crc32(content);
  const localLength = 30 + filename.length + content.length;
  const output = new Uint8Array(localLength + 46 + filename.length + 22);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, content.length, true);
  view.setUint32(22, content.length, true);
  view.setUint16(26, filename.length, true);
  output.set(filename, 30);
  output.set(content, 30 + filename.length);
  const central = localLength;
  view.setUint32(central, 0x02014b50, true);
  view.setUint16(central + 4, 20, true);
  view.setUint16(central + 6, 20, true);
  view.setUint32(central + 16, crc, true);
  view.setUint32(central + 20, content.length, true);
  view.setUint32(central + 24, content.length, true);
  view.setUint16(central + 28, filename.length, true);
  output.set(filename, central + 46);
  const end = central + 46 + filename.length;
  view.setUint32(end, 0x06054b50, true);
  view.setUint16(end + 8, 1, true);
  view.setUint16(end + 10, 1, true);
  view.setUint32(end + 12, 46 + filename.length, true);
  view.setUint32(end + 16, central, true);
  return output;
}
function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
