#!/usr/bin/env node
// @ts-check
// Prints the animation periods in an SVG, to choose a tempo and a loop length that stay in step with
// the art (midi-guide: "Syncing with the art"). Node built-ins only.
//
// Usage: node art_periods.mjs <art.svg>
//
// It lists each embedded GIF (data:image/gif;base64,...) with its frame delays and its loop, and
// every SMIL `dur` and CSS animation duration. It does not judge which animations are visible: an
// opacity animation from 1 to 0.999, for example, changes nothing a viewer can see.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The frame delays of a GIF, in milliseconds, from its graphic control extensions. Walks the
 * blocks (rather than searching for bytes), so image data can never be misread as a delay.
 * @param {Uint8Array} bytes
 * @returns {number[]}
 */
export function gifDelays(bytes) {
  const g = Buffer.from(bytes);
  if (g.toString("latin1", 0, 3) !== "GIF") throw new Error("not a GIF");
  /** Size in bytes of a colour table given a packed flags byte. */
  const table = (/** @type {number} */ flags) => (flags & 0x80 ? 3 << ((flags & 7) + 1) : 0);
  let p = 13 + table(g[10]); // header, logical screen descriptor, global colour table
  const skipSubBlocks = () => {
    while (g[p]) p += g[p] + 1;
    p++;
  };
  /** @type {number[]} */
  const delays = [];
  while (p < g.length && g[p] !== 0x3b) {
    if (g[p] === 0x21) {
      // An extension. A graphic control extension holds the frame delay in 10 ms units.
      if (g[p + 1] === 0xf9) delays.push(g.readUInt16LE(p + 4) * 10);
      p += 2;
      skipSubBlocks();
    } else if (g[p] === 0x2c) {
      // An image: its descriptor, local colour table, LZW code size, then its data sub-blocks.
      p += 10 + table(g[p + 9]) + 1;
      skipSubBlocks();
    } else {
      throw new Error(`GIF: unexpected block 0x${g[p].toString(16)} at byte ${p}`);
    }
  }
  if (g[p] !== 0x3b) throw new Error("GIF: truncated");
  return delays;
}

/**
 * The report lines for an SVG's text.
 * @param {string} svg
 * @returns {string[]}
 */
export function artPeriods(svg) {
  /** @type {string[]} */
  const lines = [];
  for (const [, b64] of svg.matchAll(/data:image\/gif;base64,([A-Za-z0-9+/=]+)/g)) {
    const delays = gifDelays(Buffer.from(b64, "base64"));
    const loop = delays.reduce((a, b) => a + b, 0);
    lines.push(`GIF: ${delays.length} frames, delays ${delays.join(", ")} ms, loop ${loop} ms`);
  }
  for (const [, dur] of svg.matchAll(/\bdur\s*=\s*['"]([^'"]+)['"]/g)) lines.push(`SMIL dur ${dur}`);
  for (const [, dur] of svg.matchAll(/animation(?:-duration)?\s*:[^;'"}]*?(\d*\.?\d+m?s)\b/g)) lines.push(`CSS animation ${dur}`);
  if (!lines.length) lines.push("no GIF, SMIL or CSS animation found");
  return lines;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file] = process.argv.slice(2);
  if (!file) {
    console.error("usage: node art_periods.mjs <art.svg>");
    process.exit(2);
  }
  for (const line of artPeriods(readFileSync(file, "utf8"))) console.log(line);
}
