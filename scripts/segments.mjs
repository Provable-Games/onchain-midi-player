// @ts-nocheck
// Artifact shape and parity are checked by segments.test.mjs and Cairo goldens.
// Canonical library-segment format and independent JS encoding reference.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { encodeSettings } from "../player/encode.js";
import { validateSettings } from "../player/validate.js";
import { ENGINE_PIN, engineNotice } from "./engine.mjs";
export const VERSION = "0.5.0";
export const SEGMENT_FORMAT = 1;
export const FIXED_ALIGNMENT = 279;
export const MANIFEST_PATH = new URL("./library_versions.json", import.meta.url);
export const JSON_PREFIX = "data:application/json;base64,";
export const SVG_PREFIX = "data:image/svg+xml;base64,";
export const HTML_PREFIX = "data:text/html;base64,";
export const URL_KEY = '"animation_url":"data:text/html;base64,';
export const IMAGE_KEY = '"image":"data:image/svg+xml;base64,';
export const SETTINGS_OPEN = '<script type="text/plain" id="onchain-midi-settings">';
export const MIDI_OPEN = '</script><script type="text/plain" id="onchain-midi-data">';
export const DATA_CLOSE = '</script>';
const PRE_ID = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const SEMVER = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-${PRE_ID}(?:\\.${PRE_ID})*)?$`);

/** Whether `v` is a valid VERSION: SemVer (see SEMVER) that fits a Cairo short string (31 bytes). */
export function isSemVer(/** @type {string} */ v) {
  return v.length <= 31 && SEMVER.test(v);
}

/**
 * SemVer precedence: negative if `a` comes before `b`, positive if after, 0 if equal. A pre-release
 * comes before its release; pre-release identifiers compare numerically when both are numbers,
 * otherwise as ASCII, with numbers first.
 * @param {string} a
 * @param {string} b
 */
export function compareSemVer(a, b) {
  const parse = (/** @type {string} */ v) => {
    const [core, pre] = v.split(/-(.*)/s);
    return { core: core.split(".").map(BigInt), pre: pre === undefined ? [] : pre.split(".") };
  };
  // Numbers compare exactly, as BigInt: SemVer puts no bound on them.
  const cmp = (/** @type {bigint} */ m, /** @type {bigint} */ n) => (m < n ? -1 : m > n ? 1 : 0);
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return cmp(x.core[i], y.core[i]);
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return cmp(BigInt(p), BigInt(q));
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length - y.pre.length;
}

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

export const SHIM_PIN = {
  fflate: "0.8.3",
  license: new URL("../tests/vendor/fflate-0.8.3.LICENSE", import.meta.url),
  licenseSha256: "0a1df3a083d0c010560aa342e87959c8c1070e6fd54545741f083f22d0c8b551",
};

/** fflate's MIT license as distributed in the pinned version, after checking its SHA-256. */
export function shimLicense() {
  const text = readFileSync(SHIM_PIN.license, "utf8");
  if (sha256(text) !== SHIM_PIN.licenseSha256) throw new Error(`${SHIM_PIN.license.pathname}: sha256 ${sha256(text)}, expected ${SHIM_PIN.licenseSha256} (SHIM_PIN in scripts/segments.mjs)`);
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
  if (sha256(text) !== ENCODER_PIN.licenseSha256) throw new Error(`${ENCODER_PIN.license.pathname}: sha256 ${sha256(text)}, expected ${ENCODER_PIN.licenseSha256} (ENCODER_PIN in scripts/segments.mjs)`);
  return text;
}

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
    `This class (version ${VERSION}) embeds in its engine segment the minified build of commit ${ENGINE_PIN.commit}`,
    `of https://github.com/Provable-Games/webaudio-tinysynth (SHA-256 ${ENGINE_PIN.sha256},`,
    "returned by script_sha256()). The NOTICE of that repository follows.",
    "",
    engineNotice().trimEnd(),
    "",
    `The loader segment embeds a gunzip routine derived from fflate ${SHIM_PIN.fflate} (https://github.com/101arrowz/fflate),`,
    "which inflates independent libraries in the browser. Its license follows.",
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


/** Complete fragments, padded outside completed elements; both encoding layers are unpadded. */
export function alignedFragment(fragment, alignment = 9) {
  return fragment + spaces(padLen(blen(fragment), alignment));
}
export function segmentFor(fragment) {
  if (blen(fragment) % 9) throw new Error("fragment is not 9-byte aligned");
  const result = b64(b64(fragment));
  if (result.includes("=")) throw new Error("segment contains padding");
  return result;
}
export function fixedFragment(name) {
  return readFileSync(new URL(`../tests/fixtures/segments/${name}.html`, import.meta.url), "utf8");
}
export function settingsText(settings) { return encodeSettings(validateSettings(settings)); }
export function dFragment(midi, settings) {
  const body = SETTINGS_OPEN + settingsText(settings) + MIDI_OPEN + b64(midi) + DATA_CLOSE;
  const d = alignedFragment(body);
  return { d, pad: blen(d) - blen(body) };
}
export const midiSegment = (midi, settings) => segmentFor(dFragment(midi, settings).d);
/** Immutable per-version records: a recorded artifact change requires a version bump. */
export function checkLibraryVersion(versions, version, entry, { record = false } = {}) {
  if (!isSemVer(version)) throw new Error("invalid class SemVer");
  if (versions[version]) {
    if (JSON.stringify(versions[version]) !== JSON.stringify(entry)) throw new Error(`library artifacts changed under recorded VERSION ${version}: bump VERSION`);
    return versions;
  }
  if (!record) throw new Error(`VERSION ${version} has no segment manifest: generate with --record`);
  for (const v of Object.keys(versions)) if (compareSemVer(version, v) <= 0) throw new Error("VERSION must increase");
  return { ...versions, [version]: entry };
}
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
 * (about 130 KB and 2,700 CASM felts more for the page constants; docs/development.md, "Class size"). Only for
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
