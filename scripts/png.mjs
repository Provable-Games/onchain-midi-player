// @ts-check
// Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced), enough for Playwright screenshots in the
// browser checks. Node built-ins only.

import { deflateSync, inflateSync } from "node:zlib";

/** CRC-32 (zlib.crc32 needs Node 22.2). @param {Buffer} buf */
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** @param {number} a @param {number} b @param {number} c */
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * @param {Buffer} buf
 * @returns {{width: number, height: number, pixel: (x: number, y: number) => number[]}}
 */
export function decodePng(buf) {
  let p = 8, width = 0, height = 0, channels = 0;
  /** @type {Buffer[]} */
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("unsupported PNG");
      channels = /** @type {Record<number, number>} */ ({ 2: 3, 6: 4 })[data[9]];
    } else if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels, px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0, b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? px[(y - 1) * stride + x - channels] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      px[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return { width, height, pixel: (x, y) => [...px.subarray(y * stride + x * channels, y * stride + x * channels + 3)] };
}

/**
 * Encodes 8-bit RGBA, non-interlaced, unfiltered rows (for test fixtures).
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => number[]} rgba
 */
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) Buffer.from(rgba(x, y)).copy(raw, y * (width * 4 + 1) + 1 + x * 4);
  const chunk = (/** @type {string} */ type, /** @type {Buffer} */ data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
