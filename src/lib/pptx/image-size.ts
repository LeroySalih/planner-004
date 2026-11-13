// Pixel size from the first bytes of a PNG, JPEG, GIF, BMP or WebP file.

export type ImageSize = { format: string; width: number; height: number }

export function readImageSize(bytes: Uint8Array): ImageSize | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString("ascii", 12, 16) === "IHDR") {
    return { format: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
  }
  if (b.length >= 10 && (b.toString("ascii", 0, 6) === "GIF87a" || b.toString("ascii", 0, 6) === "GIF89a")) {
    return { format: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
  }
  if (b.length >= 26 && b.toString("ascii", 0, 2) === "BM") {
    return { format: "bmp", width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)) }
  }
  if (b.length >= 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const chunk = b.toString("ascii", 12, 16)
    if (chunk === "VP8X") return { format: "webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
    if (chunk === "VP8 ") return { format: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21)
      return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return readJpegSize(b)
  return null
}

function readJpegSize(b: Buffer): ImageSize | null {
  let offset = 2
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = b[offset + 1]
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = b.readUInt16BE(offset + 2)
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { format: "jpeg", height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  return null
}
