// @ts-check
// Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced), enough for Playwright screenshots in the
// browser checks. Node built-ins only.

import { inflateSync } from "node:zlib";

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
