// Inspect bounded raster bytes without relying on filenames or client MIME metadata.
export function rasterImageInfo(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const word = offset => String.fromCharCode(...bytes.slice(offset, offset + 4));
  let width, height, type, extension;
  if (bytes.length >= 45 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)
    && view.getUint32(8) === 13 && word(12) === 'IHDR' && word(bytes.length - 8) === 'IEND') {
    width = view.getUint32(16); height = view.getUint32(20); type = 'image/png'; extension = 'png';
  } else if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if ([0,216,217,218].includes(marker)) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (length < 11 || bytes[offset + 2] !== 8 || length !== 8 + 3 * bytes[offset + 7]) break;
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); type = 'image/jpeg'; extension = 'jpg'; break;
      }
      offset += length;
    }
  } else if (bytes.length >= 25 && word(0) === 'RIFF' && word(8) === 'WEBP' && view.getUint32(4, true) === bytes.length - 8) {
    const chunk = word(12), chunkSize = view.getUint32(16, true);
    if (chunkSize > bytes.length - 20) return null;
    if (chunk === 'VP8 ' && chunkSize >= 10 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42 && !(bytes[20] & 1)) {
      width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383;
    } else if (chunk === 'VP8L' && chunkSize >= 5 && bytes[20] === 47) {
      const dimensions = view.getUint32(21, true); width = (dimensions & 16383) + 1; height = ((dimensions >>> 14) & 16383) + 1;
    } else if (chunk === 'VP8X' && chunkSize === 10 && bytes.length >= 30) {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    }
    type = 'image/webp'; extension = 'webp';
  }
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 4096 && height <= 4096
    && width * height <= 16 * 1024 * 1024 ? { type, extension } : null;
}
