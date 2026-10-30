// A small GIF decoder for the tests only (the page never decodes pixels itself): every frame of one
// loop as the browser shows it, RGBA, composited from a clear canvas with each frame's disposal.
// Interlaced frames, local colour tables and transparency are read; extensions other than the
// Graphic Control Extension are skipped.

/** The LZW-coded colour indices of one image (`data`: its sub-blocks joined), `count` of them. */
function lzw(data, minSize, count) {
  const clear = 1 << minSize, out = new Uint8Array(count);
  let size = minSize + 1, next = clear + 2, prev = -1, bit = 0, o = 0;
  /** @type {number[][]} */ let table = [];
  const reset = () => { table = Array.from({ length: clear }, (_, i) => [i]); table[clear] = table[clear + 1] = []; size = minSize + 1; next = clear + 2; prev = -1; };
  reset();
  while (o < count && bit + size <= data.length * 8) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code == clear) { reset(); continue; }
    if (code == clear + 1) break;
    let entry;
    if (code < next && table[code]) entry = table[code];
    else if (code == next && prev >= 0) entry = [...table[prev], table[prev][0]];
    else throw new Error("gif: bad LZW code");
    if (prev >= 0 && next < 4096) { table[next++] = [...table[prev], entry[0]]; if (next == 1 << size && size < 12) size++; }
    for (const v of entry) if (o < count) out[o++] = v;
    prev = code;
  }
  return out;
}

/**
 * @param {Uint8Array} b
 * @returns {{width: number, height: number, frames: {rgba: Uint8Array, delay: number}[]}}
 */
export function decodeGif(b) {
  if (String.fromCharCode(...b.subarray(0, 4)) != "GIF8") throw new Error("gif: not a GIF");
  const width = b[6] | (b[7] << 8), height = b[8] | (b[9] << 8), table = (/** @type {number} */ at, /** @type {number} */ flags) => b.subarray(at, at + (3 << ((flags & 7) + 1)));
  let p = 13, global = b[10] & 128 ? table(13, b[10]) : null;
  if (global) p += global.length;
  const canvas = new Uint8Array(width * height * 4), frames = [];
  let disposal = 0, transparent = -1, delay = 0;
  const blocks = () => { const parts = []; while (b[p]) { parts.push(b.subarray(p + 1, p + 1 + b[p])); p += b[p] + 1; } p++; return Uint8Array.from(parts.flatMap((x) => [...x])); };
  while (p < b.length && b[p] != 59) {
    const at = b[p++];
    if (at == 33) {
      if (b[p] == 249) { disposal = (b[p + 2] >> 2) & 7; transparent = b[p + 2] & 1 ? b[p + 5] : -1; delay = b[p + 3] | (b[p + 4] << 8); }
      p++; blocks();
    } else if (at == 44) {
      const [x, y, w, h] = [0, 2, 4, 6].map((i) => b[p + i] | (b[p + i + 1] << 8)), flags = b[p + 8];
      p += 9;
      const colours = flags & 128 ? table(p, flags) : global;
      if (flags & 128) p += /** @type {Uint8Array} */ (colours).length;
      const minSize = b[p++], indices = lzw(blocks(), minSize, w * h);
      // Interlaced rows come in four passes: every 8th from 0, every 8th from 4, every 4th from 2, every 2nd from 1.
      const rows = flags & 64 ? [[0, 8], [4, 8], [2, 4], [1, 2]].flatMap(([s, d]) => { const r = []; for (let i = s; i < h; i += d) r.push(i); return r; }) : [...Array(h).keys()];
      const saved = disposal == 3 ? canvas.slice() : null;
      rows.forEach((row, r) => {
        for (let c = 0; c < w; c++) {
          const v = indices[r * w + c], X = x + c, Y = y + row;
          if (v == transparent || X >= width || Y >= height || !colours) continue;
          canvas.set([colours[v * 3], colours[v * 3 + 1], colours[v * 3 + 2], 255], (Y * width + X) * 4);
        }
      });
      frames.push({ rgba: canvas.slice(), delay });
      if (disposal == 2) for (let Y = y; Y < Math.min(height, y + h); Y++) canvas.fill(0, (Y * width + x) * 4, (Y * width + Math.min(width, x + w)) * 4);
      else if (saved) canvas.set(saved);
      disposal = 0; transparent = -1; delay = 0;
    } else throw new Error("gif: unknown block " + at);
  }
  return { width, height, frames };
}
