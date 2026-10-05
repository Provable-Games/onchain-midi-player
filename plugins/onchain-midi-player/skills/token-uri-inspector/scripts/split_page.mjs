#!/usr/bin/env node
// @ts-check
// Splits a decoded animation_url page into the per-token blocks the class and the consumer wrote,
// and checks the art. Node built-ins only.
//
// Usage: node split_page.mjs <animation.html> [image.svg] [out_dir]
//
// The page is PAGE (the fixed part), then three inert text blocks:
//   <script type="text/plain" id="settings"> SETTINGS </script>
//   <script type="text/plain" id="midi"> base64 of the MIDI file </script>
//   <script type="text/plain" id="art"> the raw SVG, unclosed, to the end of the document
// It writes settings.txt (SETTINGS, as written, without the alignment spaces), midi.b64 and art.svg
// (the bytes after the art block's opening tag) to out_dir (default: the page's directory). With
// image.svg (the token's decoded `image`), it checks that the art block holds the same bytes. It
// checks that the art contains no `</script`, where a browser would end the art block. It reads its
// inputs before writing, and refuses an out_dir where an output would overwrite an input. Exit
// status: 0 when every check passes, 1 when one fails, 2 for a usage error, an unreadable input, or a
// page that is not an onchain-midi-player page.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SETTINGS_OPEN = '<script type="text/plain" id="settings">';
const MIDI_OPEN = '</script><script type="text/plain" id="midi">';
const ART_OPEN = '</script><script type="text/plain" id="art">';

/**
 * The blocks of a decoded animation_url page.
 * @param {Uint8Array} page
 * @returns {{settings: string, midiB64: string, art: Buffer}}
 */
export function splitPage(page) {
  const html = Buffer.from(page).toString("latin1"); // one character per byte
  const s = html.indexOf(SETTINGS_OPEN);
  const m = html.indexOf(MIDI_OPEN, s);
  const a = html.indexOf(ART_OPEN, m);
  if (s < 0 || m < 0 || a < 0) throw new Error("not an onchain-midi-player page: no settings, MIDI and art blocks in that order");
  return {
    settings: html.slice(s + SETTINGS_OPEN.length, m).trim(),
    midiB64: html.slice(m + MIDI_OPEN.length, a).trim(),
    art: Buffer.from(page).subarray(a + ART_OPEN.length),
  };
}

/**
 * The art checks: report lines, and whether they all pass.
 * @param {Buffer} art
 * @param {Uint8Array} [image]
 */
export function checkArt(art, image) {
  const lines = [];
  let ok = true;
  const at = art.toString("latin1").search(/<\/script/i);
  if (at >= 0) {
    ok = false;
    lines.push(`FAIL the art contains "</script" at byte ${at}: the browser ends the art block there and shows a broken image`);
  } else lines.push("PASS the art contains no </script");
  if (image) {
    if (art.equals(Buffer.from(image))) lines.push("PASS the art block equals the image");
    else {
      ok = false;
      lines.push(`FAIL the art block (${art.length} bytes) differs from the image (${image.length} bytes)`);
    }
  }
  return { ok, lines };
}

/**
 * Runs the command line and returns the exit status. Inputs are read before anything is written,
 * and no output may overwrite an input.
 * @param {string[]} args
 * @param {(line: string) => void} [out]
 * @param {(line: string) => void} [err]
 */
export function run(args, out = console.log, err = console.error) {
  const [pagePath, imagePath, outArg] = args;
  if (!pagePath) {
    err("usage: node split_page.mjs <animation.html> [image.svg] [out_dir]");
    return 2;
  }
  const outDir = outArg ?? dirname(pagePath);
  const outputs = ["settings.txt", "midi.b64", "art.svg"].map((name) => join(outDir, name));
  for (const input of [pagePath, imagePath]) {
    if (input && outputs.some((o) => resolve(o) === resolve(input))) {
      err(`${input} would be overwritten by an output: choose another out_dir`);
      return 2;
    }
  }
  let blocks;
  /** @type {Buffer | undefined} */
  let image;
  try {
    blocks = splitPage(readFileSync(pagePath));
    image = imagePath ? readFileSync(imagePath) : undefined;
  } catch (e) {
    err(String(/** @type {Error} */ (e).message));
    return 2;
  }
  writeFileSync(outputs[0], blocks.settings + "\n");
  writeFileSync(outputs[1], blocks.midiB64 + "\n");
  writeFileSync(outputs[2], blocks.art);
  out(`SETTINGS: ${blocks.settings.length} bytes; MIDI: ${blocks.midiB64.length} base64 characters; art: ${blocks.art.length} bytes`);
  out(`wrote settings.txt, midi.b64 and art.svg to ${outDir}`);
  const { ok, lines } = checkArt(blocks.art, image);
  for (const line of lines) out(line);
  return ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
