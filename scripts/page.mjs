// @ts-check
// JavaScript reference for everything the class returns around the page, and for the consumer
// layout that splices it (the Beasts layout in README.md and src/interface.cairo). Node built-ins
// only: it reads the built PAGE from tests/fixtures/page.html (written by scripts/build_page.mjs)
// and needs no `npm install`, so the beast_consumer example and the tests can use it directly.
//
//   PAGE                     fixed HTML: head and styles, engine <script>, player <script>, then
//                            the opening of the settings block and 0..8 alignment spaces
//   animation_url_segment    b64('"animation_url":"data:text/html;base64,' ++ b64(PAGE))
//   D                        SETTINGS MIDI_OPEN b64(midi) <pad> ART_OPEN, len(D) % 9 == 0
//   midi_segment             b64(b64(D))
//   token_uri                the consumer's pieces spliced around both segments

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { encodeSettings } from "../player/encode.js";
import { validateSettings } from "../player/settings.js";
import { ENGINE_PIN, engineNotice } from "./engine.mjs";

/** @typedef {import("../player/settings.js").SynthSettings} SynthSettings */

export const PAGE_PATH = new URL("../tests/fixtures/page.html", import.meta.url);

/**
 * Version of the page (player, markup and styles). Bump it whenever PAGE changes in a class that will
 * be declared. VERSION, returned by version(), combines it with the engine pin.
 */
export const PAGE_VERSION = 1;
export const VERSION = `tinysynth-${ENGINE_PIN.ref}+page.${PAGE_VERSION}`;

/** The text license() returns: this library's notice and license, then the embedded engine's. */
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
  ].join("\n");
}

export const SETTINGS_OPEN = '<script type="text/plain" id="settings">';
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
  // The engine and the player, and nothing else, close a <script> element.
  if (countCI(page, "</script") !== 2) throw new Error("unexpected </script in PAGE");
  return pad;
}

/** The built PAGE (tests/fixtures/page.html), checked. */
export function pageHtml() {
  const page = readFileSync(PAGE_PATH, "latin1");
  checkPage(page);
  return page;
}

/**
 * The engine and player scripts of a PAGE (the contents of its first two <script> elements).
 * @param {string} page
 */
export function pageScripts(page) {
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (scripts.length !== 2) throw new Error("PAGE must have exactly two plain <script> elements");
  return { engine: scripts[0], player: scripts[1] };
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
// The consumer's token_uri (the Beasts layout)
// ---------------------------------------------------------------------------------------------

/**
 * The consumer's own pieces for given JSON members and SVG, padded with JSON whitespace.
 * @param {string} mem
 * @param {string} svg
 */
export function consumerPieces(mem, svg) {
  const svgB64 = b64(svg);
  const headPad = padLen(blen("{" + mem + "," + IMAGE_KEY), 3);
  const head = "{" + mem + "," + spaces(headPad) + IMAGE_KEY;
  const sPad = padLen(svgB64.length + 1, 3);
  const s = svgB64 + '"' + spaces(sPad);
  return { svgB64, head, headPad, s, sPad, comma: ",  " };
}

/**
 * The spliced token_uri for any members, SVG, 9-aligned page and 9-aligned D, assembled exactly as
 * a consumer contract does it.
 * @param {{mem: string, svg: string, pageHtml: string, d: string}} parts
 */
export function spliceTokenUri({ mem, svg, pageHtml, d }) {
  const c = consumerPieces(mem, svg);
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
 */
export function naiveTokenJson({ mem, svg, pageHtml, d }) {
  const c = consumerPieces(mem, svg);
  return (
    "{" + mem + "," + spaces(c.headPad) +
    IMAGE_KEY + c.svgB64 + '"' + spaces(c.sPad) + ",  " +
    URL_KEY + b64(pageHtml + d + svg) + '"' + spaces(c.sPad) +
    "}"
  );
}

export const naiveTokenUri = (/** @type {Parameters<typeof naiveTokenJson>[0]} */ parts) => JSON_PREFIX + b64(naiveTokenJson(parts));

/**
 * Decodes a token_uri exactly as a marketplace would: JSON layer, then the two data URIs. Every
 * layer is returned as raw bytes; the JSON is decoded as strict UTF-8 (invalid UTF-8 throws), and
 * `svg` / `html` are UTF-8 text views for convenience.
 * @param {string} uri
 */
export function decodeTokenUri(uri) {
  if (!uri.startsWith(JSON_PREFIX)) throw new Error("not a base64 JSON data URI");
  if (/[^\x21-\x7e]/.test(uri)) throw new Error("token_uri must be printable ASCII");
  const jsonBytes = strictB64Decode(uri.slice(JSON_PREFIX.length));
  const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes);
  const json = JSON.parse(jsonText);
  if (!json.image.startsWith(SVG_PREFIX)) throw new Error("image is not a base64 SVG data URI");
  if (!json.animation_url.startsWith(HTML_PREFIX)) throw new Error("animation_url is not base64 HTML");
  const svgBytes = strictB64Decode(json.image.slice(SVG_PREFIX.length));
  const htmlBytes = strictB64Decode(json.animation_url.slice(HTML_PREFIX.length));
  return { jsonBytes, jsonText, json, svgBytes, htmlBytes, svg: svgBytes.toString("utf8"), html: htmlBytes.toString("utf8") };
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
