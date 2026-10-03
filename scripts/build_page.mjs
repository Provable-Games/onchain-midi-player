#!/usr/bin/env node
// @ts-check
// Offline, reproducible build of the player page (PAGE) and of the Cairo constants the class serves.
//
//   1. Loads the pinned TinySynth engine and the fork's NOTICE (scripts/engine.mjs). A SHA-256
//      mismatch fails here, before anything is generated.
//   2. Flattens player/settings.js and player/player.js into one plain script (their import lines
//      and `export` keywords removed, nothing else changed), wraps it in a function and minifies it
//      with the pinned Terser (package-lock.json). Terser is deterministic for a given version,
//      input and options, so the output is byte-identical across runs.
//   3. Assembles PAGE: head and styles, engine <script> (the pinned file's exact bytes, so
//      script_sha256() matches `sha256sum` of the fork's build), the controls, the player
//      <script>, then the opening of the settings block, padded with spaces to len % 9 == 0.
//   4. Writes tests/fixtures/page.html (PAGE, byte for byte) and src/page_data.cairo (generated:
//      animation_url_segment pre-encoded at both base64 layers, PAGE_LEN, SEGMENT_LEN,
//      ENGINE_SHA256, VERSION and the license text).
//   5. Writes the golden fixtures for phase 4 (scripts/gen_page_fixtures.mjs):
//      tests/fixtures/page.json and tests/page_fixtures.cairo.
//
// Usage (repository root, after `npm ci`):
//   node scripts/build_page.mjs           write the files and print the sizes   (npm run gen:page)
//   node scripts/build_page.mjs --check   exit 1 if any file is out of date     (npm run check:page)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { minify } from "terser";
import { ENGINE_PIN, engineSource } from "./engine.mjs";
import { pageFixtures } from "./gen_page_fixtures.mjs";
import {
  PAGE_PATH, SETTINGS_OPEN, VERSION, blen, cairoByteArrayConst, checkPage, countCI, licenseText, padLen, segmentFor,
  sha256, spaces,
} from "./page.mjs";
import { PLAY_ICON } from "../player/player.js";

export const CAIRO_PATH = new URL("../src/page_data.cairo", import.meta.url);
export const FIXTURES_JSON_PATH = new URL("../tests/fixtures/page.json", import.meta.url);
export const FIXTURES_CAIRO_PATH = new URL("../tests/page_fixtures.cairo", import.meta.url);

/** Terser options. Changing them (or the Terser version) changes PAGE. */
const TERSER_OPTIONS = /** @type {import("terser").MinifyOptions} */ ({
  ecma: 2020,
  compress: { passes: 2 },
  mangle: true,
  format: { ascii_only: true },
});

const STYLE =
  "html,body{margin:0;height:100%;overflow:hidden;background:#000}" +
  "img{position:fixed;top:0;left:0;width:100%;height:100%;object-fit:contain}" +
  "button{position:fixed;right:12px;bottom:12px;width:40px;height:40px;padding:10px;border:0;" +
  "border-radius:50%;background:rgba(0,0,0,.55);box-shadow:0 0 0 1px rgba(255,255,255,.4);color:#fff;cursor:pointer}" +
  "button:disabled{opacity:.4;cursor:default}" +
  "svg{display:block;width:100%;height:100%;fill:currentColor}" +
  "p{position:fixed;left:12px;right:64px;bottom:12px;margin:0;padding:6px 8px;background:rgba(0,0,0,.75);" +
  "color:#f88;font:12px/1.3 monospace;overflow-wrap:anywhere}";

/** Apache-2.0 §4: attribution for the embedded engine, readable in the decoded page. */
const ENGINE_COMMENT =
  "<!-- TinySynth: webaudio-tinysynth by Tatsuya Shinyagaito (g200kg), Apache-2.0, modified by" +
  " Provable Games: https://github.com/Provable-Games/webaudio-tinysynth -->";

/**
 * One module's source as plain script: its import lines and `export` keywords removed.
 * @param {string} path
 */
function flatten(path) {
  const src = readFileSync(new URL(path, import.meta.url), "utf8")
    .replace(/^import \{[^}]*\} from "\.\/settings\.js";\n/m, "")
    .replace(/^export (?=(?:const|function|class) )/gm, "");
  if (/^\s*(?:import|export)\b/m.test(src)) throw new Error(`${path}: an import or export is left after flattening`);
  return src;
}

/**
 * The player script: player/settings.js and player/player.js in one function, minified.
 * @param {{rangeRecheck?: boolean}} [options] rangeRecheck false drops validateSettings from
 *   parseSettings (only to measure what the range re-check costs; never shipped)
 */
export async function playerScript({ rangeRecheck = true } = {}) {
  let settings = flatten("../player/settings.js");
  if (!rangeRecheck) {
    const full = "return validateSettings(decodeSettings(text));";
    if (!settings.includes(full)) throw new Error("parseSettings changed; update the range re-check measurement");
    settings = settings.replace(full, "return decodeSettings(text);");
  }
  const source = `(function(){"use strict";\n${settings}\n${flatten("../player/player.js")}\nstartPlayer();\n})();\n`;
  const { code } = await minify(source, TERSER_OPTIONS);
  if (!code) throw new Error("terser produced no output");
  return code;
}

/**
 * PAGE around a given engine and player script.
 * @param {string} engine
 * @param {string} player
 */
export function assemblePage(engine, player) {
  for (const [name, js] of [["engine", engine], ["player", player]]) {
    // Script data must not end the script early or enter the HTML parser's escaped states.
    for (const bad of ["</script", "<script", "<!--"]) if (countCI(js, bad)) throw new Error(`${name} contains ${bad}`);
    if (/[^\x20-\x7e]/.test(js)) throw new Error(`${name} is not printable ASCII`);
  }
  const unpadded =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>TinySynth player</title><style>${STYLE}</style>${ENGINE_COMMENT}` +
    `<script>${engine}</script></head><body>` +
    '<button id="play" aria-label="Play" disabled>' +
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path id="icon" d="${PLAY_ICON}"/></svg></button>` +
    '<p id="error" role="alert" hidden></p>' +
    `<script>${player}</script>` +
    SETTINGS_OPEN;
  const page = unpadded + spaces(padLen(blen(unpadded), 9));
  checkPage(page);
  return page;
}

/** Builds everything; returns the files' contents and the measurements. */
export async function build() {
  const engine = engineSource();
  const player = await playerScript();
  const page = assemblePage(engine, player);
  const withoutRecheck = assemblePage(engine, await playerScript({ rangeRecheck: false }));
  const segment = segmentFor(page);
  const license = licenseText();
  if (VERSION.length > 31 || !/^[\x20-\x7e]+$/.test(VERSION)) throw new Error(`VERSION ${VERSION} is not a short string`);
  const sizes = {
    page: page.length,
    pad: page.length - page.trimEnd().length,
    engine: engine.length,
    player: player.length,
    pageWithoutRangeRecheck: withoutRecheck.length,
    playerWithoutRangeRecheck: withoutRecheck.length - page.length + player.length,
    segment: segment.length,
    license: blen(license),
  };
  const cairo = cairoSource({ page, segment, license, sizes });
  const fixtures = pageFixtures(page, { version: VERSION, license, engineCommit: ENGINE_PIN.commit, engineSha256: ENGINE_PIN.sha256 });
  return { page, cairo, fixtures, sizes, segment };
}

/**
 * src/page_data.cairo.
 * @param {{page: string, segment: string, license: string, sizes: Record<string, number>}} parts
 */
function cairoSource({ page, segment, license, sizes }) {
  const src = `//! Pre-encoded page constants. Generated by scripts/build_page.mjs. DO NOT EDIT.
//!
//! PAGE is the fixed HTML page of this class version, byte for byte the file
//! tests/fixtures/page.html. In order: head and styles, the TinySynth engine <script>, the ▶/■
//! control, the player <script>, then the opening of the settings block and its alignment spaces.
//!
//! - version(): ${VERSION}
//! - PAGE: ${sizes.page} bytes (len % 9 == 0)
//! - engine: ${sizes.engine} bytes, the fork's minified build at commit ${ENGINE_PIN.ref}
//! - player: ${sizes.player} bytes, player/player.js and player/settings.js, minified
//! - alignment spaces: ${sizes.pad}
//! - PAGE without the player's settings range re-check (validateSettings): ${sizes.pageWithoutRangeRecheck} bytes
//! - animation_url_segment(): ${sizes.segment} bytes
//!
//! animation_url_segment() = b64('"animation_url":"data:text/html;base64,' ++ b64(PAGE)),
//! computed offline: nothing is base64-encoded at call time.
//!
//! sha256(PAGE)    = ${sha256(page)}
//! sha256(segment) = ${sha256(segment)}

/// Length of PAGE in bytes (a multiple of 9).
pub const PAGE_LEN: u32 = ${page.length};

/// Length of \`animation_url_segment()\` in bytes: \`4 * (39 + 4 * PAGE_LEN / 3) / 3\`.
pub const SEGMENT_LEN: u32 = ${segment.length};

/// SHA-256 of the embedded engine script, big-endian: exactly the bytes of the fork's
/// \`webaudio-tinysynth.min.js\` at commit ${ENGINE_PIN.commit},
/// as embedded in PAGE.
pub const ENGINE_SHA256: u256 = 0x${ENGINE_PIN.sha256};

/// \`version()\`: the engine pin and the page version.
pub const VERSION: felt252 = '${VERSION}';

${cairoByteArrayConst("animation_url_segment", "ANIMATION_URL_SEGMENT", segment, [
  "The `animation_url` JSON member, pre-encoded at both layers, left open for `midi_segment()`.",
])}

${cairoByteArrayConst("license", "LICENSE", license, [
  "`license()`: the Apache-2.0 notice for this library and the embedded engine, including the",
  `fork's list of modifications (${sizes.license} bytes).`,
])}
`;
  // scarb fmt rewraps comment lines longer than 100 characters; keep the output formatter-stable.
  const long = src.split("\n").find((line) => line.length > 100);
  if (long) throw new Error(`generated Cairo line longer than 100 characters: ${long}`);
  return src;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { page, cairo, fixtures, sizes } = await build();
  const files = /** @type {Array<[URL, string]>} */ ([
    [PAGE_PATH, page], [CAIRO_PATH, cairo], [FIXTURES_JSON_PATH, fixtures.json], [FIXTURES_CAIRO_PATH, fixtures.cairo],
  ]);
  if (process.argv.includes("--check")) {
    const stale = files.filter(([path, text]) => {
      try {
        return readFileSync(path, "utf8") !== text;
      } catch {
        return true;
      }
    });
    for (const [path] of stale) console.error(`out of date: ${fileURLToPath(path)} (run npm run gen:page)`);
    process.exit(stale.length ? 1 : 0);
  }
  for (const [path, text] of files) writeFileSync(path, text);
  console.log(`${VERSION}: PAGE ${sizes.page} bytes (engine ${sizes.engine}, player ${sizes.player}, pad ${sizes.pad}), segment ${sizes.segment}`);
  console.log(`without the settings range re-check: PAGE ${sizes.pageWithoutRangeRecheck} bytes (player ${sizes.playerWithoutRangeRecheck})`);
  console.log(`license ${sizes.license} bytes`);
}
