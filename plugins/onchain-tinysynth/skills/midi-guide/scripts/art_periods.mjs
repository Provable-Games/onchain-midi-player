#!/usr/bin/env node
// @ts-check
// Prints the animation periods in an SVG, to choose a tempo and a loop length that stay in step with
// the art (midi-guide: "Syncing with the art"). Node built-ins only.
//
// Usage: node art_periods.mjs <art.svg>
//
// It lists each embedded GIF (data:image/gif;base64,...) with its frame delays and its loop, every
// SMIL `dur` (one repeat of the animation's values), and every CSS animation's iteration duration,
// doubled for `alternate` animations, which repeat every two iterations. It flags GIF delays under 20 ms (or missing), which
// browsers do not show as encoded. It does not judge which animations are visible: an opacity animation from 1 to
// 0.999, for example, changes nothing a viewer can see.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Frame delays below this (0 or 10 ms) are not shown as encoded: browsers substitute a longer delay,
 * so the encoded sum is not the period a viewer sees.
 */
export const MIN_RELIABLE_DELAY = 20;

/**
 * The frame delays of a GIF, in milliseconds: one per image, from the graphic control extension
 * before it. An image with no control extension gets 0 (no delay given), which the report flags.
 * Walks the blocks (rather than searching for bytes), so image data can never be misread as a delay.
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
  /** The delay of the last graphic control extension, which applies to the next image only. */
  let pending = 0;
  while (p < g.length && g[p] !== 0x3b) {
    if (g[p] === 0x21) {
      // An extension. A graphic control extension holds the next frame's delay in 10 ms units.
      if (g[p + 1] === 0xf9) pending = g.readUInt16LE(p + 4) * 10;
      p += 2;
      skipSubBlocks();
    } else if (g[p] === 0x2c) {
      // An image: its descriptor, local colour table, LZW code size, then its data sub-blocks.
      delays.push(pending);
      pending = 0;
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
 * A CSS time ("1.5s", "800ms") in milliseconds.
 * @param {string} time
 */
const ms = (time) => Math.round(parseFloat(time) * (time.endsWith("ms") ? 1 : 1000));

/**
 * Every CSS animation in a text: each entry of an `animation` shorthand list (its first time value is
 * the iteration duration; a second one is the delay) and of an `animation-duration` list. A CSS
 * duration is one iteration: with `alternate` or `alternate-reverse` the art repeats only every two
 * iterations, which `alternate` records for shorthand entries. An `animation-direction` property is
 * reported on its own, since it cannot be matched to its animations here.
 * @param {string} text
 * @returns {Array<{duration: string, alternate: boolean} | {direction: string}>}
 */
export function cssAnimations(text) {
  /** @type {Array<{duration: string, alternate: boolean} | {direction: string}>} */
  const found = [];
  for (const [, property, value] of text.matchAll(/(?<![\w-])(?:-webkit-)?animation(-duration|-direction)?\s*:\s*([^;}'"]+)/g)) {
    if (property === "-direction") {
      if (/\balternate/.test(value)) found.push({ direction: value.trim() });
      continue;
    }
    // Split the list at top-level commas only: cubic-bezier(...) and steps(...) hold commas too.
    let depth = 0;
    let entry = "";
    const entries = [];
    for (const c of value) {
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (c === "," && depth === 0) {
        entries.push(entry);
        entry = "";
      } else entry += c;
    }
    entries.push(entry);
    for (const e of entries) {
      const bare = e.replace(/\([^)]*\)/g, "");
      const time = bare.match(/(?<![\w.-])(\d*\.?\d+m?s)(?!\w)/);
      const duration = time ? time[1] : e.trim();
      found.push({ duration, alternate: !property && /(?<![\w-])alternate(-reverse)?(?![\w-])/.test(bare) });
    }
  }
  return found;
}

/** The iteration durations of every CSS animation in a text (see cssAnimations). */
export const cssDurations = (/** @type {string} */ text) =>
  cssAnimations(text).flatMap((a) => ("duration" in a ? [a.duration] : []));

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
    const short = delays.filter((d) => d < MIN_RELIABLE_DELAY);
    lines.push(`GIF: ${delays.length} frames, delays ${delays.join(", ")} ms, ${short.length ? "encoded " : ""}loop ${loop} ms`);
    if (short.length) {
      lines.push(`  warning: ${short.length} frame delay${short.length > 1 ? "s" : ""} under ${MIN_RELIABLE_DELAY} ms; browsers show very short delays longer than encoded, so measure this GIF's period in a browser`);
    }
  }
  for (const [, dur] of svg.matchAll(/\bdur\s*=\s*['"]([^'"]+)['"]/g)) lines.push(`SMIL dur ${dur}`);
  for (const a of cssAnimations(svg)) {
    if ("direction" in a) lines.push(`CSS animation-direction ${a.direction}: an alternate animation repeats every 2 iterations`);
    else if (a.alternate) lines.push(`CSS animation iteration ${a.duration}, alternate: repeats every ${2 * ms(a.duration)} ms`);
    else lines.push(`CSS animation iteration ${a.duration}`);
  }
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
