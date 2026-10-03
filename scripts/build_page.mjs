#!/usr/bin/env node
// @ts-check
// Offline, reproducible build of the player page (PAGE) and of the Cairo constants the class serves.
//
//   1. Loads the pinned TinySynth engine and the fork's NOTICE (scripts/engine.mjs). A SHA-256
//      mismatch fails here, before anything is generated.
//   2. Gzips the engine with the pinned fflate (package-lock.json) at level 9 with no timestamp and
//      no file name. fflate is pure JavaScript, so the payload depends only on its version, the
//      input and the options, never on the system zlib or the OS.
//   3. Flattens player/gunzip.js (the shim that inflates the engine in the page) into a plain
//      script and minifies it with the pinned Terser, then checks its SHA-256 against SHIM_PIN
//      (scripts/page.mjs). Flattens player/settings.js and player/player.js into one plain script
//      (their import lines and `export` keywords removed, nothing else changed), wraps it in a
//      function and minifies it. Terser is deterministic for a given version, input and options,
//      so the output is byte-identical across runs.
//   4. Assembles PAGE: head and styles, the engine's gzip payload in a
//      <script type="text/javascript+gzip" src="data:text/javascript;base64,...">, the shim
//      <script>, the controls, the player <script>, then the opening of the settings block, padded
//      with spaces to len % 9 == 0. The payload inflates to the pinned file's exact bytes, so
//      script_sha256() matches `sha256sum` of the fork's build.
//   5. Writes tests/fixtures/page.html (PAGE, byte for byte) and src/page_data.cairo (generated:
//      animation_url_segment pre-encoded at both base64 layers, PAGE_LEN, SEGMENT_LEN,
//      ENGINE_SHA256, GZIP_SHA256, GZIP_LEN, VERSION and the license text).
//   6. Writes the golden fixtures for phase 4 (scripts/gen_page_fixtures.mjs):
//      tests/fixtures/page.json and tests/page_fixtures.cairo.
//
// Usage (repository root, after `npm ci`):
//   node scripts/build_page.mjs           write the files and print the sizes   (npm run gen:page)
//   node scripts/build_page.mjs --check   exit 1 if any file is out of date     (npm run check:page)
//   node scripts/build_page.mjs --record  also record a new VERSION in scripts/page_versions.json
//
// Every run fails if PAGE changed while VERSION stayed the same (scripts/page_versions.json maps
// each VERSION to the SHA-256 of its PAGE): bump PAGE_VERSION in scripts/page.mjs, then --record.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { gzipSync } from "fflate";
import { minify } from "terser";
import { ENGINE_PIN, engineSource } from "./engine.mjs";
import { pageFixtures } from "./gen_page_fixtures.mjs";
import {
  GZIP_CLOSE, GZIP_OPEN, PAGE_PATH, PAGE_VERSIONS_PATH, SETTINGS_OPEN, SHIM_PIN, VERSION, b64, blen, bytes,
  cairoBase64Literal, cairoByteArrayConst, checkPage, checkPageVersion, countCI, licenseText, padLen, pageScripts,
  segmentFor, sha256, shimLicense, spaces,
} from "./page.mjs";
import { gunzip } from "../player/gunzip.js";
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

/**
 * fflate's gzip options. Level 9 (fflate's best), and mtime 0 and no filename, so the header holds
 * no timestamp or name: the payload is a function of the engine bytes alone. Changing them (or the
 * fflate version) changes PAGE.
 */
const GZIP_OPTIONS = /** @type {import("fflate").GzipOptions} */ ({ level: 9, mtime: 0 });

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
  "<!-- TinySynth (gzipped below): webaudio-tinysynth by Tatsuya Shinyagaito (g200kg), Apache-2.0," +
  " modified by Provable Games: https://github.com/Provable-Games/webaudio-tinysynth -->";

/** Attribution for the gunzip shim (the full MIT text is in license()). */
const SHIM_COMMENT =
  `<!-- gunzip: derived from fflate ${SHIM_PIN.fflate}, Copyright (c) 2026 Arjun Barrett, MIT License:` +
  " https://github.com/101arrowz/fflate -->";

/**
 * The engine's gzip payload, checked to inflate back to the engine with both Node's zlib and the
 * page's own gunzip.
 * @param {string} engine
 */
export function gzipEngine(engine) {
  const gz = Buffer.from(gzipSync(bytes(engine), GZIP_OPTIONS));
  if (!gunzipSync(gz).equals(bytes(engine))) throw new Error("the gzip payload does not inflate to the engine (zlib)");
  if (!Buffer.from(gunzip(gz)).equals(bytes(engine))) throw new Error("the gzip payload does not inflate to the engine (player/gunzip.js)");
  return gz;
}

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
 * The gunzip shim: player/gunzip.js in a function that runs `gunzipScripts()`, minified, checked
 * against SHIM_PIN.
 */
export async function shimScript() {
  const fflate = JSON.parse(readFileSync(new URL("../node_modules/fflate/package.json", import.meta.url), "utf8")).version;
  if (fflate !== SHIM_PIN.fflate) throw new Error(`fflate ${fflate} is installed but the shim derives from ${SHIM_PIN.fflate} (SHIM_PIN in scripts/page.mjs): run npm ci, or re-derive and re-pin the shim`);
  if (readFileSync(new URL("../node_modules/fflate/LICENSE", import.meta.url), "utf8") !== shimLicense()) throw new Error("tests/vendor's fflate LICENSE differs from the installed fflate's");
  const source = `(function(){"use strict";\n${flatten("../player/gunzip.js")}\ngunzipScripts();\n})();\n`;
  const { code } = await minify(source, TERSER_OPTIONS);
  if (!code) throw new Error("terser produced no output");
  if (sha256(code) !== SHIM_PIN.sha256) {
    throw new Error(`the minified gunzip shim changed: sha256 ${sha256(code)} (${code.length} bytes), pinned ${SHIM_PIN.sha256}. ` +
      "It inflates the engine in every token's page: review the change, then update SHIM_PIN.sha256 in scripts/page.mjs");
  }
  return code;
}

/** The player script: player/settings.js and player/player.js in one function, minified. */
export async function playerScript() {
  const source = `(function(){"use strict";\n${flatten("../player/settings.js")}\n${flatten("../player/player.js")}\nstartPlayer();\n})();\n`;
  const { code } = await minify(source, TERSER_OPTIONS);
  if (!code) throw new Error("terser produced no output");
  // Range and semantic validation is Cairo's job (settings::validate); the page only parses.
  const rule = code.match(/out of range|duplicate timbre slot|no operators|target not earlier|unsupported/);
  if (rule) throw new Error(`the player contains a settings validation rule ("${rule[0]}"); validation belongs to Cairo`);
  return code;
}

/**
 * PAGE around a given engine gzip payload, shim and player script. The payload goes in as base64,
 * whose alphabet (A-Z a-z 0-9 + / =) has no `<`, `"` or `&`: it can neither end its tag or its
 * attribute nor start a character reference.
 * @param {Uint8Array} engineGzip
 * @param {string} shim
 * @param {string} player
 */
export function assemblePage(engineGzip, shim, player) {
  for (const [name, js] of [["shim", shim], ["player", player]]) {
    // Script data must not end the script early or enter the HTML parser's escaped states.
    for (const bad of ["</script", "<script", "<!--"]) if (countCI(js, bad)) throw new Error(`${name} contains ${bad}`);
    if (/[^\x20-\x7e]/.test(js)) throw new Error(`${name} is not printable ASCII`);
  }
  const payload = b64(engineGzip);
  if (!/^[A-Za-z0-9+/=]+$/.test(payload)) throw new Error("payload is not base64");
  const unpadded =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>TinySynth player</title><style>${STYLE}</style>${ENGINE_COMMENT}` +
    `${GZIP_OPEN}${payload}${GZIP_CLOSE}${SHIM_COMMENT}<script>${shim}</script></head><body>` +
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
  const engineGzip = gzipEngine(engine);
  const shim = await shimScript();
  const player = await playerScript();
  const page = assemblePage(engineGzip, shim, player);
  // The page reads back as built: the payload inflates to the engine, the scripts are the built ones.
  const read = pageScripts(page);
  if (read.engine !== engine || !read.engineGzip.equals(engineGzip) || read.shim !== shim || read.player !== player) {
    throw new Error("PAGE does not read back as built");
  }
  const segment = segmentFor(page);
  const license = licenseText();
  if (VERSION.length > 31 || !/^[\x20-\x7e]+$/.test(VERSION)) throw new Error(`VERSION ${VERSION} is not a short string`);
  const sizes = {
    page: page.length,
    pad: page.length - page.trimEnd().length,
    engine: engine.length,
    gzip: engineGzip.length,
    gzipB64: b64(engineGzip).length,
    shim: shim.length,
    player: player.length,
    segment: segment.length,
    license: blen(license),
  };
  const gzipSha256 = sha256(engineGzip);
  const cairo = cairoSource({ page, segment, license, sizes, gzipSha256, shimSha256: sha256(shim) });
  const fixtures = pageFixtures(page, {
    version: VERSION, license, engineCommit: ENGINE_PIN.commit, engineSha256: ENGINE_PIN.sha256,
    gzipSha256, gzipLen: engineGzip.length, shimSha256: sha256(shim),
  });
  return { page, cairo, fixtures, sizes, segment };
}

/**
 * src/page_data.cairo.
 * @param {{page: string, segment: string, license: string, sizes: Record<string, number>, gzipSha256: string, shimSha256: string}} parts
 */
function cairoSource({ page, segment, license, sizes, gzipSha256, shimSha256 }) {
  const src = `//! Pre-encoded page constants. Generated by scripts/build_page.mjs. DO NOT EDIT.
//!
//! PAGE is the fixed HTML page of this class version, byte for byte the file
//! tests/fixtures/page.html. In order: head and styles, the TinySynth engine gzipped in a
//! <script type="text/javascript+gzip" src="data:text/javascript;base64,...">, the gunzip shim
//! <script> that inflates it, the ▶/■ control, the player <script>, then the opening of the
//! settings block and its alignment spaces.
//!
//! - version(): ${VERSION}
//! - PAGE: ${sizes.page} bytes (len % 9 == 0)
//! - engine: ${sizes.engine} bytes, the fork's minified build at commit ${ENGINE_PIN.ref}, gzipped
//!   to ${sizes.gzip} bytes (fflate ${SHIM_PIN.fflate}, level 9), ${sizes.gzipB64} as base64
//! - shim: ${sizes.shim} bytes, player/gunzip.js (derived from fflate ${SHIM_PIN.fflate}), minified
//! - player: ${sizes.player} bytes, player/player.js and player/settings.js, minified
//! - alignment spaces: ${sizes.pad}
//! - animation_url_segment(): ${sizes.segment} bytes
//!
//! animation_url_segment() = b64('"animation_url":"data:text/html;base64,' ++ b64(PAGE)),
//! computed offline: nothing is base64-encoded at call time.
//!
//! sha256(PAGE)    = ${sha256(page)}
//! sha256(segment) = ${sha256(segment)}
//! sha256(shim)    = ${shimSha256}

/// Length of PAGE in bytes (a multiple of 9).
pub const PAGE_LEN: u32 = ${page.length};

/// Length of \`animation_url_segment()\` in bytes: \`4 * (39 + 4 * PAGE_LEN / 3) / 3\`.
pub const SEGMENT_LEN: u32 = ${segment.length};

/// SHA-256 of the embedded engine script, big-endian: exactly the bytes of the fork's
/// \`webaudio-tinysynth.min.js\` at commit ${ENGINE_PIN.commit},
/// as the gzip payload in PAGE inflates to.
pub const ENGINE_SHA256: u256 = 0x${ENGINE_PIN.sha256};

/// SHA-256 of the gzip payload in PAGE, big-endian: the bytes that the engine tag's
/// \`data:text/javascript;base64,\` URI decodes to. Gunzipped, they are the engine (ENGINE_SHA256).
pub const GZIP_SHA256: u256 = 0x${gzipSha256};

/// Length of the gzip payload in bytes.
pub const GZIP_LEN: u32 = ${sizes.gzip};

/// \`version()\`: the engine pin and the page version.
pub const VERSION: felt252 = '${VERSION}';

${cairoBase64Literal("animation_url_segment", segment, [
  "The `animation_url` JSON member, pre-encoded at both layers, left open for `midi_segment()`.",
  "A string literal: the compiler stores its words as constants, which is the cheapest way to",
  "materialize it (see `cairoBase64Literal` in scripts/page.mjs).",
])}

${cairoByteArrayConst("license", "LICENSE", license, [
  "`license()`: the Apache-2.0 notice for this library and the embedded engine, including the",
  `fork's list of modifications (${sizes.license} bytes).`,
])}
`;
  // scarb fmt rewraps comment lines longer than 100 characters; keep the output formatter-stable.
  // It leaves string literals alone: the segment's base64 literal is the only long line.
  const long = src.split("\n").find((line) => line.length > 100 && !/^ {4}"[A-Za-z0-9+/=]*"$/.test(line));
  if (long) throw new Error(`generated Cairo line longer than 100 characters: ${long}`);
  return src;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { page, cairo, fixtures, sizes } = await build();
  const versions = JSON.parse(readFileSync(PAGE_VERSIONS_PATH, "utf8"));
  let recorded;
  try {
    recorded = checkPageVersion(versions, VERSION, sha256(page), { record: process.argv.includes("--record") });
  } catch (e) {
    console.error(/** @type {Error} */ (e).message);
    process.exit(1);
  }
  const files = /** @type {Array<[URL, string]>} */ ([
    [PAGE_PATH, page], [CAIRO_PATH, cairo], [FIXTURES_JSON_PATH, fixtures.json], [FIXTURES_CAIRO_PATH, fixtures.cairo],
    [PAGE_VERSIONS_PATH, JSON.stringify(recorded, null, 2) + "\n"],
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
  console.log(`${VERSION}: PAGE ${sizes.page} bytes (engine ${sizes.engine} gzipped to ${sizes.gzip}, ${sizes.gzipB64} as base64;` +
    ` shim ${sizes.shim}; player ${sizes.player}; pad ${sizes.pad}), segment ${sizes.segment}`);
  console.log(`license ${sizes.license} bytes`);
}
