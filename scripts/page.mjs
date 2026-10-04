// @ts-check
// JavaScript reference for everything the class returns around the page, and for the consumer
// layout that splices it ("Consumer `token_uri` layout" in README.md and src/interface.cairo).
// Node built-ins only: it reads the built PAGE from tests/fixtures/page.html (written by scripts/build_page.mjs)
// and needs no `npm install`, so the beast_consumer example and the tests can use it directly.
//
//   PAGE                     fixed HTML: head and styles, the engine gzipped in a
//                            <script type="text/javascript+gzip" src="data:...">, the gunzip
//                            shim <script>, the player <script>, then the opening of the settings
//                            block and 0..8 alignment spaces
//   animation_url_segment    b64('"animation_url":"data:text/html;base64,' ++ b64(PAGE))
//   D                        SETTINGS MIDI_OPEN b64(midi) <pad> ART_OPEN, len(D) % 9 == 0
//   midi_segment             b64(b64(D))
//   token_uri                the consumer's pieces spliced around both segments

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { encodeSettings } from "../player/encode.js";
import { validateSettings } from "../player/validate.js";
import { ENGINE_PIN, engineNotice } from "./engine.mjs";

/** @typedef {import("../player/settings.js").SynthSettings} SynthSettings */

export const PAGE_PATH = new URL("../tests/fixtures/page.html", import.meta.url);

/**
 * Version of the page (player, markup and styles). VERSION, returned by version(), combines it with
 * the engine pin. scripts/page_versions.json records the SHA-256 of PAGE for every VERSION, and the
 * build fails when PAGE changes under a recorded VERSION: bump PAGE_VERSION (or re-pin the engine),
 * then record the new VERSION with `npm run gen:page -- --record`.
 */
export const PAGE_VERSION = 6;
export const VERSION = `tinysynth-${ENGINE_PIN.ref}+page.${PAGE_VERSION}`;
export const PAGE_VERSIONS_PATH = new URL("./page_versions.json", import.meta.url);

/**
 * The gunzip shim in PAGE: player/gunzip.js (derived from fflate 0.8.3, MIT), flattened and minified
 * by scripts/build_page.mjs with the pinned Terser. Its SHA-256 is pinned here, so the bytes that
 * inflate the engine in every token's page change only deliberately: the build fails when the
 * minified shim differs (after an edit to player/gunzip.js, or a Terser or option change). Review
 * the new minified shim, then update `sha256`. `license` is the vendored fflate LICENSE that goes
 * into license(), also SHA-256 checked; `fflate` is the version the shim derives from and the build
 * compresses with (package-lock.json pins it).
 */
export const SHIM_PIN = {
  fflate: "0.8.3",
  sha256: "bf6316a818dc7519afafa5af7bf826af5280c9950d208f0a2822f4295ab0d4df",
  license: new URL("../tests/vendor/fflate-0.8.3.LICENSE", import.meta.url),
  licenseSha256: "0a1df3a083d0c010560aa342e87959c8c1070e6fd54545741f083f22d0c8b551",
};

/** fflate's MIT license as distributed in the pinned version, after checking its SHA-256. */
export function shimLicense() {
  const text = readFileSync(SHIM_PIN.license, "utf8");
  if (sha256(text) !== SHIM_PIN.licenseSha256) throw new Error(`${SHIM_PIN.license.pathname}: sha256 ${sha256(text)}, expected ${SHIM_PIN.licenseSha256} (SHIM_PIN in scripts/page.mjs)`);
  return text;
}

/**
 * The class's base64 encoder: `game_components_encoding`, a Scarb dependency (see Scarb.toml). Its
 * code is compiled into the class, so its MIT license goes into license(). `license` is
 * game-components' LICENSE file, vendored and SHA-256 checked (see tests/vendor/README.md).
 */
export const ENCODER_PIN = {
  license: new URL("../tests/vendor/game-components.LICENSE", import.meta.url),
  licenseSha256: "4f7adc00655ded5638937698858cd3b302ee48069b924c6e456b9ef6e3f35f10",
};

/** game-components' MIT license, after checking its SHA-256. */
export function encoderLicense() {
  const text = readFileSync(ENCODER_PIN.license, "utf8");
  if (sha256(text) !== ENCODER_PIN.licenseSha256) throw new Error(`${ENCODER_PIN.license.pathname}: sha256 ${sha256(text)}, expected ${ENCODER_PIN.licenseSha256} (ENCODER_PIN in scripts/page.mjs)`);
  return text;
}

/**
 * Checks that `version` names exactly this PAGE in the record of versions (VERSION -> sha256(PAGE)),
 * so version() can never stay the same while the page changes. With `record`, a VERSION not yet in
 * it is added. Returns the (possibly extended) record; throws if the page changed under a recorded
 * VERSION, or if VERSION is new and `record` is false.
 * @param {Record<string, string>} versions
 * @param {string} version
 * @param {string} digest sha256(PAGE)
 * @param {{record?: boolean}} [options]
 */
export function checkPageVersion(versions, version, digest, { record = false } = {}) {
  const known = versions[version];
  if (known === digest) return versions;
  if (known !== undefined) {
    throw new Error(`PAGE changed (sha256 ${digest}) but VERSION ${version} is recorded for sha256 ${known}: ` +
      "bump PAGE_VERSION in scripts/page.mjs (or re-pin the engine), then run npm run gen:page -- --record");
  }
  for (const [v, d] of Object.entries(versions)) {
    if (d === digest) throw new Error(`this PAGE is already recorded as ${v}; VERSION ${version} would name it twice`);
  }
  if (!record) throw new Error(`VERSION ${version} is not recorded in scripts/page_versions.json: run npm run gen:page -- --record`);
  return { ...versions, [version]: digest };
}

/**
 * The text license() returns: this library's notice and license, then the embedded engine's, then
 * the gunzip shim's, then the base64 encoder's.
 */
export function licenseText() {
  const notice = readFileSync(new URL("../NOTICE", import.meta.url), "utf8").trimEnd();
  return [
    notice,
    "",
    'Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in',
    "compliance with the License. You may obtain a copy of the License at",
    "",
    "    http://www.apache.org/licenses/LICENSE-2.0",
    "",
    "Unless required by applicable law or agreed to in writing, software distributed under the License is",
    'distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or',
    "implied. See the License for the specific language governing permissions and limitations under the",
    "License.",
    "",
    `This class (${VERSION}) embeds in its page the minified build of commit ${ENGINE_PIN.commit}`,
    `of https://github.com/Provable-Games/webaudio-tinysynth (SHA-256 ${ENGINE_PIN.sha256},`,
    "returned by script_sha256()). The NOTICE of that repository follows.",
    "",
    engineNotice().trimEnd(),
    "",
    `The page also embeds a gunzip routine derived from fflate ${SHIM_PIN.fflate} (https://github.com/101arrowz/fflate),`,
    "which inflates the engine in the browser. Its license follows.",
    "",
    shimLicense().trimEnd(),
    "",
    "The class also embeds the base64 encoder of game-components (the package game_components_encoding,",
    "https://github.com/Provable-Games/game-components), which encodes the per-token data at call time.",
    "Its license follows.",
    "",
    encoderLicense().trimEnd(),
    "",
  ].join("\n");
}

export const SETTINGS_OPEN = '<script type="text/plain" id="settings">';
/** Opens the engine's tag: the gzip payload's base64 follows, then GZIP_CLOSE. */
export const GZIP_OPEN = '<script type="text/javascript+gzip" src="data:text/javascript;base64,';
export const GZIP_CLOSE = '"></script>';

/**
 * A page or decoded animation_url HTML with its gzip tag's base64 payload replaced by
 * `edit(payload)`, or the whole tag removed when `edit` returns null: the failure variants of the
 * page tests.
 * @param {string} html
 * @param {(payload: string) => string | null} edit
 */
export function withGzipPayload(html, edit) {
  const at = html.indexOf(GZIP_OPEN);
  const end = html.indexOf(GZIP_CLOSE, at);
  if (at < 0 || end < 0) throw new Error("no gzip tag");
  const payload = edit(html.slice(at + GZIP_OPEN.length, end));
  return html.slice(0, at) + (payload === null ? "" : GZIP_OPEN + payload + GZIP_CLOSE) + html.slice(end + GZIP_CLOSE.length);
}
export const MIDI_OPEN = '</script><script type="text/plain" id="midi">';
export const ART_OPEN = '</script><script type="text/plain" id="art">';
export const URL_KEY = '"animation_url":"data:text/html;base64,';
export const IMAGE_KEY = '"image":"data:image/svg+xml;base64,';
export const JSON_PREFIX = "data:application/json;base64,";
export const SVG_PREFIX = "data:image/svg+xml;base64,";
export const HTML_PREFIX = "data:text/html;base64,";

// ---------------------------------------------------------------------------------------------
// Bytes and base64
// ---------------------------------------------------------------------------------------------

/**
 * A string (encoded as UTF-8, like Cairo ByteArray literals) or bytes, as a Buffer.
 * @param {string | Uint8Array} x
 */
export const bytes = (x) => (typeof x === "string" ? Buffer.from(x, "utf8") : Buffer.from(x.buffer, x.byteOffset, x.byteLength));
/** Length in bytes, which is what every alignment rule counts. */
export const blen = (/** @type {string | Uint8Array} */ x) => bytes(x).length;
/** Standard RFC 4648 base64 with `=` padding, as an ASCII string. */
export const b64 = (/** @type {string | Uint8Array} */ x) => bytes(x).toString("base64");
export const spaces = (/** @type {number} */ n) => " ".repeat(n);
/** Number of spaces that brings `len` up to a multiple of `k`. */
export const padLen = (/** @type {number} */ len, /** @type {number} */ k) => (k - (len % k)) % k;
/** SHA-256 as lowercase hex. */
export const sha256 = (/** @type {string | Uint8Array} */ x) => createHash("sha256").update(bytes(x)).digest("hex");

/**
 * Number of case-insensitive occurrences of `needle`.
 * @param {string} haystack
 * @param {string} needle
 */
export const countCI = (haystack, needle) => haystack.toLowerCase().split(needle.toLowerCase()).length - 1;

/**
 * Strict base64 decode: rejects anything that does not round-trip (e.g. `=` mid-stream).
 * @param {string} s
 */
export function strictB64Decode(s) {
  const buf = Buffer.from(s, "base64");
  if (buf.toString("base64") !== s) throw new Error("not canonical standard base64");
  return buf;
}

// ---------------------------------------------------------------------------------------------
// PAGE and the class's outputs
// ---------------------------------------------------------------------------------------------

/**
 * Checks the structural rules of a PAGE and returns how many alignment spaces end it.
 * @param {string} page
 */
export function checkPage(page) {
  if (/[^\x20-\x7e]/.test(page)) throw new Error("PAGE must be printable ASCII");
  if (page.length % 9) throw new Error("PAGE not 9-aligned");
  const pad = page.length - page.trimEnd().length;
  if (pad > 8 || !page.trimEnd().endsWith(SETTINGS_OPEN)) throw new Error("PAGE must end with the settings block opening and 0..8 spaces");
  // The engine's gzip tag, the shim and the player, and nothing else, close a <script> element.
  if (countCI(page, "</script") !== 3) throw new Error("unexpected </script in PAGE");
  if (page.split(GZIP_OPEN).length !== 2) throw new Error("PAGE must have exactly one gzip tag");
  return pad;
}

/** The built PAGE (tests/fixtures/page.html), checked. */
export function pageHtml() {
  const page = readFileSync(PAGE_PATH, "latin1");
  checkPage(page);
  return page;
}

/**
 * The scripts of a PAGE (or of a decoded animation_url HTML, which starts with PAGE): the engine's
 * gzip payload (the bytes its tag's data: URI carries) and the engine it inflates to (Node's zlib,
 * which checks the gzip CRC-32 and length), and the contents of the two plain <script> elements,
 * the shim and the player.
 * @param {string} page
 */
export function pageScripts(page) {
  const tags = [...page.matchAll(/<script type="text\/javascript\+gzip" src="data:text\/javascript;base64,([^"]*)"><\/script>/g)];
  if (tags.length !== 1) throw new Error("PAGE must have exactly one gzip tag");
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (scripts.length !== 2) throw new Error("PAGE must have exactly two plain <script> elements");
  const engineGzip = strictB64Decode(tags[0][1]);
  return { engineGzip, engine: gunzipSync(engineGzip).toString("utf8"), shim: scripts[0], player: scripts[1] };
}

/**
 * b64('"animation_url":"data:text/html;base64,' ++ b64(page)) for any 9-aligned page.
 * @param {string} page
 */
export function segmentFor(page) {
  if (blen(page) % 9) throw new Error("page not 9-aligned");
  const inner = URL_KEY + b64(page);
  if (blen(inner) % 3) throw new Error("segment inner not 3-aligned");
  const seg = b64(inner);
  if (seg.includes("=")) throw new Error("segment padded");
  return seg;
}

/**
 * SETTINGS: validated and encoded by the JS reference (player/settings.js, player/encode.js),
 * which mirror src/settings.cairo check for check. Throws a SettingsError on invalid settings,
 * where midi_segment reverts.
 * @param {SynthSettings} settings
 */
export function settingsText(settings) {
  const text = encodeSettings(validateSettings(settings));
  if (!/^[0-9,-]*$/.test(text)) throw new Error("SETTINGS charset");
  return text;
}

/**
 * D = SETTINGS MIDI_OPEN b64(midi) <pad> ART_OPEN, with 0..8 pad spaces so len(D) % 9 == 0.
 * @param {Uint8Array} midi
 * @param {SynthSettings} settings
 */
export function dFragment(midi, settings) {
  const head = settingsText(settings) + MIDI_OPEN + b64(midi);
  const pad = padLen(blen(head) + blen(ART_OPEN), 9);
  const d = head + spaces(pad) + ART_OPEN;
  if (blen(d) % 9) throw new Error("D not 9-aligned");
  return { d, pad };
}

/** midi_segment(midi, settings) = b64(b64(D)). */
export const midiSegment = (/** @type {Uint8Array} */ midi, /** @type {SynthSettings} */ settings) => b64(b64(dFragment(midi, settings).d));

// ---------------------------------------------------------------------------------------------
// The consumer's token_uri (the consumer layout)
// ---------------------------------------------------------------------------------------------

/** A Cairo ByteArray word: a piece appended at a multiple of 31 bytes is copied word by word. */
export const WORD_BYTES = 31;
/** `b64(' ' + IMAGE_KEY)`: the image key after one space, 36 bytes, so its own aligned piece. */
export const IMAGE_KEY_B64 = b64(" " + IMAGE_KEY);

/**
 * The consumer's own pieces for given JSON members and SVG, padded with JSON whitespace.
 *
 * With `align`, the consumer also adds groups of 3 spaces between JSON tokens (`b64('   ')` is the
 * constant `'ICAg'`; 4 and 31 are coprime, so at most 30 groups) so that its two largest appends
 * start on a 31-byte word boundary of its `token_uri` ByteArray, where `ByteArray::append` copies
 * whole words instead of splitting every word in two:
 * - the first `b64(S)`: the consumer encodes `'{' members ',' <pad>` (padded to a multiple of 3),
 *   appends `'ICAg'` groups, then the constant `IMAGE_KEY_B64`, the 48-character
 *   `b64(' "image":"data:image/svg+xml;base64,')` (the image key after one space is 36 bytes);
 * - `animation_url_segment()`: the comma piece is the constant `'LCAg'` (`b64(',  ')`), then
 *   `'ICAg'` groups.
 * None of the alignment spaces is base64-encoded at call time, and every piece is still a multiple
 * of 3 bytes, so the base64 layout is unchanged.
 * @param {string} mem
 * @param {string} svg
 * @param {{align?: boolean}} [options]
 */
export function consumerPieces(mem, svg, { align = false } = {}) {
  const svgB64 = b64(svg);
  const open = "{" + mem + ",";
  let headPad = padLen(blen(open + IMAGE_KEY), 3);
  const sPad = padLen(svgB64.length + 1, 3);
  const s = svgB64 + '"' + spaces(sPad);
  let comma = ",  ";
  if (align) {
    const b64Len = (/** @type {number} */ n) => (n / 3) * 4;
    headPad = padLen(blen(open), 3) + 1;
    while ((JSON_PREFIX.length + b64Len(blen(open) + headPad + IMAGE_KEY.length)) % WORD_BYTES) headPad += 3;
    const segmentAt = JSON_PREFIX.length + b64Len(blen(open) + headPad + IMAGE_KEY.length) + b64Len(blen(s));
    while ((segmentAt + b64Len(comma.length)) % WORD_BYTES) comma += "   ";
  }
  const head = open + spaces(headPad) + IMAGE_KEY;
  return { svgB64, head, headPad, s, sPad, comma };
}

/**
 * The spliced token_uri for any members, SVG, 9-aligned page and 9-aligned D, assembled exactly as
 * a consumer contract does it.
 * @param {{mem: string, svg: string, pageHtml: string, d: string}} parts
 * @param {{align?: boolean}} [options] see consumerPieces
 */
export function spliceTokenUri({ mem, svg, pageHtml, d }, options = {}) {
  const c = consumerPieces(mem, svg, options);
  for (const piece of [c.head, c.s, c.comma]) if (blen(piece) % 3) throw new Error("unaligned piece");
  if (blen(d) % 9) throw new Error("D not 9-aligned");
  const sB64 = b64(c.s);
  return JSON_PREFIX + b64(c.head) + sB64 + b64(c.comma) + segmentFor(pageHtml) + b64(b64(d)) + sB64 + b64("}");
}

/**
 * Naive reference: the whole JSON as one string with standard nested data URIs, base64-encoded
 * once. Its whitespace between JSON tokens is the same insignificant whitespace the spliced version
 * uses for alignment.
 * @param {{mem: string, svg: string, pageHtml: string, d: string}} parts
 * @param {{align?: boolean}} [options] see consumerPieces
 */
export function naiveTokenJson({ mem, svg, pageHtml, d }, options = {}) {
  const c = consumerPieces(mem, svg, options);
  return (
    "{" + mem + "," + spaces(c.headPad) +
    IMAGE_KEY + c.svgB64 + '"' + spaces(c.sPad) + c.comma +
    URL_KEY + b64(pageHtml + d + svg) + '"' + spaces(c.sPad) +
    "}"
  );
}

export const naiveTokenUri = (
  /** @type {Parameters<typeof naiveTokenJson>[0]} */ parts,
  /** @type {{align?: boolean}} */ options = {},
) => JSON_PREFIX + b64(naiveTokenJson(parts, options));

/**
 * Decodes a token_uri's layers whatever its `image` is: the JSON layer, then the `animation_url`
 * page, and the `image` only when it is a base64 SVG data URI (`svgBytes` is null otherwise, for
 * an external URL or another format). For consumers whose art block is not their `image`.
 * @param {string} uri
 * @returns {{jsonBytes: Buffer, jsonText: string, json: any, svgBytes: Buffer | null, htmlBytes: Buffer, html: string}}
 */
export function decodeTokenUriLayers(uri) {
  if (!uri.startsWith(JSON_PREFIX)) throw new Error("not a base64 JSON data URI");
  if (/[^\x21-\x7e]/.test(uri)) throw new Error("token_uri must be printable ASCII");
  const jsonBytes = strictB64Decode(uri.slice(JSON_PREFIX.length));
  const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes);
  const json = JSON.parse(jsonText);
  if (typeof json.animation_url !== "string" || !json.animation_url.startsWith(HTML_PREFIX)) throw new Error("animation_url is not base64 HTML");
  const svgBytes = typeof json.image === "string" && json.image.startsWith(SVG_PREFIX) ? strictB64Decode(json.image.slice(SVG_PREFIX.length)) : null;
  const htmlBytes = strictB64Decode(json.animation_url.slice(HTML_PREFIX.length));
  return { jsonBytes, jsonText, json, svgBytes, htmlBytes, html: htmlBytes.toString("utf8") };
}

/**
 * Decodes a token_uri exactly as a marketplace would: JSON layer, then the two data URIs. Every
 * layer is returned as raw bytes; the JSON is decoded as strict UTF-8 (invalid UTF-8 throws), and
 * `svg` / `html` are UTF-8 text views for convenience. The `image` must be a base64 SVG data URI
 * (see decodeTokenUriLayers for other images).
 * @param {string} uri
 */
export function decodeTokenUri(uri) {
  const layers = decodeTokenUriLayers(uri);
  const { svgBytes } = layers;
  if (!svgBytes) throw new Error("image is not a base64 SVG data URI");
  return { ...layers, svgBytes, svg: svgBytes.toString("utf8") };
}

// ---------------------------------------------------------------------------------------------
// Cairo emitters
// ---------------------------------------------------------------------------------------------

/**
 * ByteArray Serde layout: [full_words_len, word_0..word_n (31 bytes each), pending_word,
 * pending_len], as Cairo felt literals.
 * @param {string | Uint8Array} x
 */
export function byteArrayFelts(x) {
  const b = bytes(x);
  const full = Math.floor(b.length / 31);
  const hex = (/** @type {Buffer} */ buf) => (buf.length ? "0x" + buf.toString("hex") : "0");
  const felts = [`${full}`];
  for (let i = 0; i < full; i++) felts.push(hex(b.subarray(i * 31, i * 31 + 31)));
  const rest = b.subarray(full * 31);
  felts.push(hex(rest), `${rest.length}`);
  return felts;
}

/**
 * The items of a Cairo array literal at indentation `indent`, laid out as `scarb fmt` does (line
 * width 100): filling each line greedily, every item followed by a comma.
 * @param {string[]} items
 * @param {number} indent
 */
export function fillLines(items, indent) {
  const pad = " ".repeat(indent);
  const lines = [];
  let line = "";
  for (const item of items) {
    const next = line ? `${line} ${item},` : `${pad}${item},`;
    if (next.length > 100 && line) {
      lines.push(line);
      line = `${pad}${item},`;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/**
 * A `const` felt array declaration, laid out as `scarb fmt` does: on one line if it fits, else one
 * item per line or filled greedily.
 * @param {string} name
 * @param {string[]} felts
 */
export function constFeltArray(name, felts) {
  const head = `const ${name}: [felt252; ${felts.length}] = [`;
  const inline = `${head}${felts.join(", ")}];`;
  return inline.length <= 100 ? inline : [head, fillLines(felts, 4), "];"].join("\n");
}

/**
 * A ByteArray constant as a string literal in a function body. The compiler lowers a literal to
 * the ByteArray's words as constants, so materializing it costs a fraction of deserializing a
 * `const` felt array (0.28M against 3.70M L2 gas for the 42,644-byte segment), for a larger class
 * (about 130 KB and 2,700 CASM felts more for the page constants; README, "Class size"). Only for
 * base64 text, which needs no escaping; `scarb fmt` leaves the long literal line alone.
 * @param {string} fnName
 * @param {string} text
 * @param {string[]} doc
 */
export function cairoBase64Literal(fnName, text, doc) {
  if (!/^[A-Za-z0-9+/=]*$/.test(text)) throw new Error(`${fnName}: not base64 text`);
  return [...doc.map((l) => (l ? `/// ${l}` : "///")), `pub fn ${fnName}() -> ByteArray {`, `    "${text}"`, "}"].join("\n");
}

/**
 * A ByteArray constant: its Serde felts in a `const` fixed-size array (stored once in the class's
 * bytecode, the cheapest form of constant data in Cairo) and a function that deserializes it.
 * Formatter-stable output.
 * @param {string} fnName
 * @param {string} constName
 * @param {string | Uint8Array} x
 * @param {string[]} doc
 */
export function cairoByteArrayConst(fnName, constName, x, doc) {
  const felts = byteArrayFelts(x);
  return [
    ...doc.map((l) => (l ? `/// ${l}` : "///")),
    `pub fn ${fnName}() -> ByteArray {`,
    `    let mut felts = ${constName}.span();`,
    "    Serde::deserialize(ref felts).unwrap()",
    "}",
    "",
    `/// \`${fnName}()\` as ByteArray Serde felts.`,
    constFeltArray(constName, felts),
  ].join("\n");
}
