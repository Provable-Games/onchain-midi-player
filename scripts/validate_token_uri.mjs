#!/usr/bin/env node
// @ts-check
// Validates a token_uri built with this player against OpenSea's metadata standards and against the
// player page this repository produces (docs/verifying.md: "Validating a token_uri"). It decodes
// every layer (ByteArray felts, data URI, base64, JSON, the image SVG, the animation_url page) and
// reports the first error of each with its position. Node built-ins only; it imports the repository's
// own checks (verify_engine, check_midi, the settings decoder and the skill's bytearray and split_page
// helpers), so run it from a checkout whose VERSION equals the class's version().
//
// Usage: node scripts/validate_token_uri.mjs <file | -> [options]
//        node scripts/validate_token_uri.mjs --rpc <url> --contract <address> --token <id> [options]
//   --expect <sha256>  the engine's SHA-256 (script_sha256()), instead of the record of the checked version
//   --version <semver> the record of scripts/page_versions.json to check against (default: VERSION)
//   --json             print the report as JSON
//   --rpc <url>        fetch the token_uri with starknet_call (or set STARKNET_RPC_URL); the URL is never printed
//
// The input file is a token_uri (data:application/json;base64,...), the decoded token JSON, or the
// output of a token_uri call: a raw starknet_call response (or just its result array of felts), or
// `sncast --json call` output.
//
// Standards (every check names its source in the report):
//   OpenSea, Media and traits: https://docs.opensea.io/docs/media-and-traits
//   OpenSea, Metadata storage: https://docs.opensea.io/docs/metadata-storage
//   ERC-721, metadata JSON schema: https://eips.ethereum.org/EIPS/eip-721
// Exit status: 0 when nothing fails (warnings allowed), 1 when a check fails, 2 for a usage error or
// an input that cannot be read or fetched.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeSettings } from "../player/settings.js";
import { validateSettings } from "../player/validate.js";
import { byteArrayFromFelts, shortStrings, tokenUriFromCall } from "../plugins/onchain-midi-player/skills/token-uri-inspector/scripts/bytearray.mjs";
import { checkArt, splitPage } from "../plugins/onchain-midi-player/skills/token-uri-inspector/scripts/split_page.mjs";
import { checkScore } from "./check_midi.mjs";
import { ART_OPEN, PAGE_VERSIONS_PATH, VERSION } from "./page.mjs";
import { normalizeSha256, verifyEngine } from "./verify_engine.mjs";

/** Where each check comes from. */
export const SOURCES = {
  "OpenSea media-and-traits": "https://docs.opensea.io/docs/media-and-traits",
  "OpenSea metadata-storage": "https://docs.opensea.io/docs/metadata-storage",
  "ERC-721": "https://eips.ethereum.org/EIPS/eip-721 (metadata JSON schema)",
  "token-uri-layout": "docs/token-uri-layout.md",
  verifying: "docs/verifying.md",
  "midi-contract": "docs/midi-contract.md",
  "sound-settings": "docs/sound-settings.md",
  "gas limits": "docs/gas.md#node-limits (jsonrpsee caps responses at 10 MiB)",
  validator: "this validator's own rule",
};

/** A JSON-RPC response is capped at 10 MiB by nodes built on jsonrpsee. */
export const RPC_CAP = 10 * 1024 * 1024;
/** Characters one full ByteArray word takes in a JSON-RPC response: `"0x` + 62 hex digits + `",`. */
const WORD_CHARS = 67;
/** Warn when the response is within 20% of the cap. */
const RPC_WARN = 0.8 * RPC_CAP;
/** Warn when the SVG is larger than this (a heuristic: OpenSea gives no limit for data URIs). */
export const IMAGE_WARN = 1024 * 1024;

const JSON_PREFIX = "data:application/json;base64,";
const SVG_PREFIX = "data:image/svg+xml;base64,";
const HTML_PREFIX = "data:text/html;base64,";
const SVG_NS = "http://www.w3.org/2000/svg";
/** Fields OpenSea (media-and-traits) and ERC-721 define. */
const FIELDS = ["name", "description", "image", "animation_url", "external_url", "attributes", "background_color"];
/** Fields older OpenSea documentation listed; the current documentation does not. */
const LEGACY_FIELDS = ["image_data", "youtube_url"];
const DISPLAY_TYPES = ["number", "boost_number", "boost_percentage", "date"];

// ---------------------------------------------------------------------------------------------
// Small decoders that say where they fail
// ---------------------------------------------------------------------------------------------

/**
 * Why a string is not canonical standard base64, with the offset of the first problem; null if it is.
 * @param {string} s
 * @returns {string | null}
 */
export function base64Problem(s) {
  const bad = s.search(/[^A-Za-z0-9+/=]/);
  if (bad >= 0) return `invalid character ${JSON.stringify(s[bad])} at offset ${bad}`;
  const pad = s.indexOf("=");
  if (pad >= 0 && !/^={1,2}$/.test(s.slice(pad))) return `padding "=" at offset ${pad} is not at the end`;
  if (s.length % 4) return `length ${s.length} is not a multiple of 4`;
  if (Buffer.from(s, "base64").toString("base64") !== s) return "not canonical: non-zero trailing bits";
  return null;
}

/**
 * Strict UTF-8 text of some bytes, or the offset of the first invalid byte.
 * @param {Uint8Array} bytes
 * @returns {{text: string} | {error: string}}
 */
function utf8(bytes) {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    // Find the first invalid byte: the longest prefix that decodes.
    let lo = 0;
    let hi = bytes.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, mid), { stream: true });
        lo = mid;
      } catch {
        hi = mid - 1;
      }
    }
    return { error: `invalid UTF-8 near byte ${lo}` };
  }
}

/** keccak-256 (not SHA3-256: Starknet selectors use the original padding). */
export function keccak256(/** @type {Uint8Array} */ data) {
  const M = (1n << 64n) - 1n;
  const rol = (/** @type {bigint} */ x, /** @type {number} */ n) => (n ? ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M : x);
  const A = new Array(25).fill(0n);
  const block = (/** @type {Uint8Array} */ b) => {
    for (let i = 0; i < 17; i++) {
      let lane = 0n;
      for (let j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(b[i * 8 + j]);
      A[i] ^= lane;
    }
    let R = 1;
    for (let round = 0; round < 24; round++) {
      const C = [0, 1, 2, 3, 4].map((x) => A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20]);
      for (let x = 0; x < 5; x++) {
        const D = C[(x + 4) % 5] ^ rol(C[(x + 1) % 5], 1);
        for (let y = 0; y < 5; y++) A[x + 5 * y] ^= D;
      }
      let [x, y] = [1, 0];
      let cur = A[1];
      for (let t = 0; t < 24; t++) {
        [x, y] = [y, (2 * x + 3 * y) % 5];
        [cur, A[x + 5 * y]] = [A[x + 5 * y], rol(cur, ((t + 1) * (t + 2)) / 2 % 64)];
      }
      for (let yy = 0; yy < 5; yy++) {
        const T = [0, 1, 2, 3, 4].map((xx) => A[xx + 5 * yy]);
        for (let xx = 0; xx < 5; xx++) A[xx + 5 * yy] = T[xx] ^ (~T[(xx + 1) % 5] & M & T[(xx + 2) % 5]);
      }
      for (let j = 0; j < 7; j++) {
        R = ((R << 1) ^ ((R >> 7) * 0x71)) % 256;
        if (R & 2) A[0] ^= 1n << BigInt((1 << j) - 1);
      }
    }
  };
  const padded = new Uint8Array(Math.ceil((data.length + 1) / 136) * 136);
  padded.set(data);
  padded[data.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  for (let o = 0; o < padded.length; o += 136) block(padded.subarray(o, o + 136));
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(A[i], i * 8);
  return out;
}

/** A Starknet entry point selector: the low 250 bits of keccak-256 of the name. */
export const selector = (/** @type {string} */ name) => "0x" + (BigInt("0x" + keccak256(Buffer.from(name)).toString("hex")) & ((1n << 250n) - 1n)).toString(16).padStart(64, "0");

// ---------------------------------------------------------------------------------------------
// A small XML well-formedness check for the SVG (no dependencies)
// ---------------------------------------------------------------------------------------------

class XmlError extends Error {
  /** @param {string} message @param {number} at */
  constructor(message, at) {
    super(message);
    this.at = at;
  }
}

/** "line L, column C" of an offset. */
function lineCol(/** @type {string} */ s, /** @type {number} */ at) {
  const before = s.slice(0, at);
  const line = before.split("\n").length;
  return `line ${line}, column ${at - before.lastIndexOf("\n")}`;
}

/**
 * Parses XML for well-formedness (one root; matching, properly nested tags; quoted unique attributes;
 * known entities; bound namespace prefixes) and collects what the reference checks need. A DOCTYPE
 * is accepted (a browser does not fetch its DTD) and its internal subset reported; processing
 * instructions other than the XML declaration are rejected. Throws an `XmlError`.
 * @param {string} s
 */
export function parseXml(s) {
  /** @type {{el: string, name: string, value: string, at: number}[]} */
  const attrs = [];
  /** @type {{text: string, at: number}[]} */
  const styles = [];
  /** @type {string[]} */
  const elements = [];
  /** @type {{name: string, scope: Map<string, string>}[]} */
  const stack = [];
  /** @type {{local: string, ns: string | undefined} | null} */
  let root = null;
  let rootClosed = false;
  let doctype = false;
  let internalSubset = false;
  const n = s.length;
  let i = s.charCodeAt(0) === 0xfeff ? 1 : 0;
  const NAME = /[A-Za-z_:À-￿][A-Za-z0-9_:.\-·À-￿]*/y;
  const name = (/** @type {number} */ at, /** @type {string} */ what) => {
    NAME.lastIndex = at;
    const m = NAME.exec(s);
    if (!m) throw new XmlError(`invalid ${what} name`, at);
    return m[0];
  };
  const ws = (/** @type {number} */ at) => {
    while (at < n && " \t\r\n".includes(s[at])) at++;
    return at;
  };
  const text = (/** @type {string} */ t, /** @type {number} */ at) => {
    const ent = t.search(/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/);
    if (ent >= 0) throw new XmlError("undefined entity or a bare &", at + ent);
    const ctl = t.search(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
    if (ctl >= 0) throw new XmlError("control character", at + ctl);
  };
  while (i < n) {
    if (s[i] !== "<") {
      let j = s.indexOf("<", i);
      if (j < 0) j = n;
      const t = s.slice(i, j);
      if (!stack.length) {
        if (/[^ \t\r\n]/.test(t)) throw new XmlError("text outside the root element", i);
      } else {
        text(t, i);
        if (t.includes("]]>")) throw new XmlError('"]]>" in text', i + t.indexOf("]]>"));
        if (stack[stack.length - 1].name === "style") styles.push({ text: t, at: i });
      }
      i = j;
    } else if (s.startsWith("<!--", i)) {
      const j = s.indexOf("-->", i + 4);
      if (j < 0) throw new XmlError("unterminated comment", i);
      if (s.slice(i + 4, j).includes("--")) throw new XmlError('"--" inside a comment', i);
      i = j + 3;
    } else if (s.startsWith("<![CDATA[", i)) {
      const j = s.indexOf("]]>", i);
      if (!stack.length) throw new XmlError("CDATA outside the root element", i);
      if (j < 0) throw new XmlError("unterminated CDATA section", i);
      if (stack[stack.length - 1].name === "style") styles.push({ text: s.slice(i + 9, j), at: i });
      i = j + 3;
    } else if (s.startsWith("<?", i)) {
      const j = s.indexOf("?>", i);
      if (j < 0) throw new XmlError("unterminated processing instruction", i);
      if (!/^<\?xml[ \t\r\n]/.test(s.slice(i, i + 7)) || i > (s.charCodeAt(0) === 0xfeff ? 1 : 0)) throw new XmlError("processing instruction (only a leading XML declaration is allowed)", i);
      i = j + 2;
    } else if (s.startsWith("<!DOCTYPE", i)) {
      if (root || doctype) throw new XmlError("DOCTYPE after the root element or a second DOCTYPE", i);
      doctype = true;
      const open = s.indexOf("[", i);
      const gt = s.indexOf(">", i);
      if (gt < 0) throw new XmlError("unterminated DOCTYPE", i);
      if (open >= 0 && open < gt) {
        // An internal subset can declare entities: it is skipped, and reported as its own rule.
        internalSubset = true;
        const end = s.indexOf("]", open);
        const close = end < 0 ? -1 : s.indexOf(">", end);
        if (close < 0) throw new XmlError("unterminated DOCTYPE internal subset", i);
        i = close + 1;
      } else i = gt + 1;
    } else if (s.startsWith("<!", i)) {
      throw new XmlError("markup declaration outside a DOCTYPE", i);
    } else if (s.startsWith("</", i)) {
      const nm = name(i + 2, "closing tag");
      const top = stack.pop();
      if (!top) throw new XmlError(`closing tag </${nm}> with nothing open`, i);
      if (top.name !== nm) throw new XmlError(`closing tag </${nm}> does not match <${top.name}>`, i);
      const e = ws(i + 2 + nm.length);
      if (s[e] !== ">") throw new XmlError("closing tag is not closed with >", e);
      if (!stack.length) rootClosed = true;
      i = e + 1;
    } else {
      if (rootClosed) throw new XmlError("more than one root element", i);
      const nm = name(i + 1, "tag");
      let k = i + 1 + nm.length;
      /** @type {{name: string, value: string, at: number}[]} */
      const own = [];
      let selfClosed = false;
      for (;;) {
        const w = ws(k);
        if (s[w] === ">") {
          k = w + 1;
          break;
        }
        if (s.startsWith("/>", w)) {
          selfClosed = true;
          k = w + 2;
          break;
        }
        if (w >= n) throw new XmlError(`unterminated <${nm}> tag`, i);
        if (w === k) throw new XmlError("expected whitespace before the attribute", w);
        const an = name(w, "attribute");
        let e = ws(w + an.length);
        if (s[e] !== "=") throw new XmlError(`attribute ${an} has no =value`, e);
        e = ws(e + 1);
        const q = s[e];
        if (q !== '"' && q !== "'") throw new XmlError(`attribute ${an} is not quoted`, e);
        const close = s.indexOf(q, e + 1);
        if (close < 0) throw new XmlError(`unterminated value of attribute ${an}`, e);
        const value = s.slice(e + 1, close);
        if (value.includes("<")) throw new XmlError(`"<" in the value of attribute ${an}`, e + 1 + value.indexOf("<"));
        text(value, e + 1);
        if (own.some((a) => a.name === an)) throw new XmlError(`duplicate attribute ${an}`, w);
        own.push({ name: an, value, at: w });
        k = close + 1;
      }
      const scope = new Map(stack.length ? stack[stack.length - 1].scope : [["xml", "http://www.w3.org/XML/1998/namespace"]]);
      for (const a of own) {
        if (a.name === "xmlns") scope.set("", a.value);
        else if (a.name.startsWith("xmlns:")) scope.set(a.name.slice(6), a.value);
      }
      const prefix = (/** @type {string} */ q) => (q.includes(":") ? q.slice(0, q.indexOf(":")) : "");
      if (prefix(nm) && !scope.has(prefix(nm))) throw new XmlError(`unbound namespace prefix ${prefix(nm)}: in <${nm}>`, i);
      for (const a of own) {
        if (a.name !== "xmlns" && !a.name.startsWith("xmlns:") && prefix(a.name) && !scope.has(prefix(a.name))) {
          throw new XmlError(`unbound namespace prefix ${prefix(a.name)}: in attribute ${a.name} (declare xmlns:${prefix(a.name)})`, a.at);
        }
        attrs.push({ el: nm, ...a });
      }
      elements.push(nm);
      if (!root) root = { local: nm.slice(nm.indexOf(":") + 1), ns: scope.get(prefix(nm)) };
      if (selfClosed) {
        if (!stack.length) rootClosed = true;
      } else stack.push({ name: nm, scope });
      i = k;
    }
  }
  if (stack.length) throw new XmlError(`<${stack[stack.length - 1].name}> is never closed`, n);
  if (!root) throw new XmlError("no root element", 0);
  return { root, attrs, styles, elements, internalSubset };
}

/**
 * Problems with external references and scripts in an SVG, as `[message, offset]`.
 * @param {ReturnType<typeof parseXml>} xml
 */
function svgReferenceProblems(xml) {
  /** @type {[string, number][]} */
  const out = [];
  const external = (/** @type {string} */ target) => !/^(#|data:)/i.test(target.trim());
  const urls = (/** @type {string} */ css, /** @type {number} */ at, /** @type {string} */ where) => {
    for (const m of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gis)) if (external(m[2])) out.push([`${where} has url(${m[2].slice(0, 60)}), outside the document and data: URIs`, at]);
    if (/@import/i.test(css)) out.push([`${where} has @import`, at]);
  };
  for (const el of xml.elements) if (el.slice(el.indexOf(":") + 1).toLowerCase() === "script") out.push(["<script> element", 0]);
  for (const a of xml.attrs) {
    const local = a.name.slice(a.name.indexOf(":") + 1).toLowerCase();
    if (a.name === "xmlns" || a.name.startsWith("xmlns:")) continue; // namespace names are identifiers, not links
    if (/^on/.test(local)) out.push([`event handler attribute ${a.name} on <${a.el}>`, a.at]);
    if ((local === "href" || local === "src") && external(a.value)) out.push([`${a.name}="${a.value.slice(0, 60)}" on <${a.el}> points outside the document and data: URIs`, a.at]);
    urls(a.value, a.at, `attribute ${a.name} on <${a.el}>`);
  }
  for (const st of xml.styles) urls(st.text, st.at, "a <style> element");
  return out;
}

// ---------------------------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------------------------

/** @typedef {{level: "pass" | "warn" | "fail" | "info", id: string, message: string, source: keyof typeof SOURCES}} Check */

class Report {
  constructor() {
    /** @type {Check[]} */
    this.checks = [];
    /** @type {Record<string, number>} */
    this.sizes = {};
    /** @type {Record<string, string>} */
    this.hashes = {};
  }
  /** @param {Check["level"]} level @param {string} id @param {string} message @param {keyof typeof SOURCES} source */
  add(level, id, message, source) {
    this.checks.push({ level, id, message, source });
  }
  pass = (/** @type {string} */ id, /** @type {string} */ m, /** @type {keyof typeof SOURCES} */ s) => this.add("pass", id, m, s);
  warn = (/** @type {string} */ id, /** @type {string} */ m, /** @type {keyof typeof SOURCES} */ s) => this.add("warn", id, m, s);
  fail = (/** @type {string} */ id, /** @type {string} */ m, /** @type {keyof typeof SOURCES} */ s) => this.add("fail", id, m, s);
  info = (/** @type {string} */ id, /** @type {string} */ m, /** @type {keyof typeof SOURCES} */ s) => this.add("info", id, m, s);
  /** @param {boolean} ok @param {string} id @param {string} okMessage @param {string} failMessage @param {keyof typeof SOURCES} source */
  check(ok, id, okMessage, failMessage, source) {
    this.add(ok ? "pass" : "fail", id, ok ? okMessage : failMessage, source);
  }
  count(/** @type {Check["level"]} */ level) {
    return this.checks.filter((c) => c.level === level).length;
  }
  failed(/** @type {string} */ id) {
    return this.checks.some((c) => c.level === "fail" && c.id === id);
  }
  toJSON() {
    const [pass, warn, fail] = ["pass", "warn", "fail"].map((l) => this.count(/** @type {Check["level"]} */ (l)));
    return { ok: fail === 0, summary: { pass, warn, fail }, checks: this.checks, sizes: this.sizes, hashes: this.hashes, sources: SOURCES };
  }
}

const isObject = (/** @type {unknown} */ v) => v !== null && typeof v === "object" && !Array.isArray(v);
const kind = (/** @type {unknown} */ v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

/**
 * The token_uri bytes (or the token JSON) in a file's contents, and how many felts the ByteArray had.
 * @param {Buffer} buf
 * @returns {{uri?: string, json?: string, felts?: number}}
 */
export function parseInput(buf) {
  const text = buf.toString("utf8").trim();
  if (text.startsWith("data:")) return { uri: text };
  if (!text.startsWith("[") && !text.startsWith("{")) throw new Error("the input is not a data URI, token JSON or token_uri call output");
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    doc = undefined; // possibly sncast output with extra lines; tokenUriFromCall reads those
  }
  if (Array.isArray(doc)) return { uri: byteArrayFromFelts(doc).toString("latin1"), felts: doc.length };
  if (isObject(doc) && !["result", "response", "error"].some((k) => k in doc)) return { json: text };
  const bytes = tokenUriFromCall(text);
  const result = isObject(doc) && Array.isArray(doc.result) ? doc.result.length : undefined;
  return { uri: bytes.toString("latin1"), felts: result };
}

/**
 * The OpenSea / ERC-721 checks of the token JSON's fields and attributes.
 * @param {Report} r
 * @param {unknown} json
 */
function checkFields(r, json) {
  if (!isObject(json)) {
    r.fail("json.object", `the JSON is ${kind(json)}, not an object`, "ERC-721");
    return;
  }
  const o = /** @type {Record<string, unknown>} */ (json);
  r.pass("json.object", "the JSON is an object", "ERC-721");
  for (const key of ["name", "image"]) {
    if (!(key in o)) r.fail(`json.${key}`, `missing "${key}"`, "OpenSea media-and-traits");
    else if (typeof o[key] !== "string") r.fail(`json.${key}`, `"${key}" is ${kind(o[key])}, not a string`, "ERC-721");
    else if (o[key] === "") r.warn(`json.${key}`, `"${key}" is empty`, "OpenSea media-and-traits");
    else r.pass(`json.${key}`, `"${key}" is a string`, "ERC-721");
  }
  if (!("description" in o)) r.warn("json.description", 'no "description" (OpenSea shows it; ERC-721 lists it)', "OpenSea media-and-traits");
  else if (typeof o.description !== "string") r.fail("json.description", `"description" is ${kind(o.description)}, not a string`, "ERC-721");
  else r.pass("json.description", '"description" is a string', "ERC-721");
  if ("external_url" in o) {
    const v = o.external_url;
    let proto = "";
    try {
      proto = new URL(/** @type {string} */ (v)).protocol;
    } catch {
      proto = "";
    }
    if (typeof v !== "string" || !proto) r.fail("json.external_url", '"external_url" is not an absolute URL string', "OpenSea media-and-traits");
    else if (proto !== "https:" && proto !== "http:") r.warn("json.external_url", `"external_url" is a ${proto} URL: OpenSea links to a website`, "OpenSea media-and-traits");
    else r.pass("json.external_url", '"external_url" is an http(s) URL', "OpenSea media-and-traits");
  }
  if ("background_color" in o) {
    const v = o.background_color;
    const hint = typeof v === "string" && v.startsWith("#") ? " (without the leading #)" : "";
    r.check(typeof v === "string" && /^[0-9a-fA-F]{6}$/.test(v), "json.background_color", '"background_color" is six hex digits', `"background_color" must be six hex digits${hint}, got ${JSON.stringify(v)}`, "OpenSea media-and-traits");
  }
  for (const key of ["youtube_url", "image_data"]) {
    if (key in o) r.warn(`json.${key}`, `"${key}" is not in OpenSea's current documentation`, "OpenSea media-and-traits");
  }
  const unknown = Object.keys(o).filter((k) => !FIELDS.includes(k) && !LEGACY_FIELDS.includes(k));
  if (unknown.length) r.warn("json.unknown_fields", `fields OpenSea does not list: ${unknown.map((k) => JSON.stringify(k)).join(", ")}`, "OpenSea media-and-traits");
  else r.pass("json.unknown_fields", "no fields OpenSea does not list", "OpenSea media-and-traits");
  if (!("attributes" in o)) r.warn("json.attributes", 'no "attributes": OpenSea shows no traits', "OpenSea media-and-traits");
  else if (!Array.isArray(o.attributes)) r.fail("json.attributes", `"attributes" is ${kind(o.attributes)}, not an array`, "OpenSea media-and-traits");
  else checkAttributes(r, o.attributes);
}

/**
 * @param {Report} r
 * @param {unknown[]} attributes
 */
function checkAttributes(r, attributes) {
  const before = r.checks.length;
  attributes.forEach((a, i) => {
    const at = `attributes[${i}]`;
    const id = "json.attributes";
    const src = "OpenSea media-and-traits";
    if (!isObject(a)) return r.fail(id, `${at} is ${kind(a)}, not an object`, src);
    const t = /** @type {Record<string, unknown>} */ (a);
    const label = typeof t.trait_type === "string" ? `${at} (${t.trait_type})` : at;
    if (!("value" in t)) return r.fail(id, `${label} has no "value"`, src);
    const unknown = Object.keys(t).filter((k) => !["trait_type", "value", "display_type", "max_value"].includes(k));
    if (unknown.length) r.warn(id, `${label} has fields OpenSea does not list: ${unknown.join(", ")}`, src);
    if ("trait_type" in t && typeof t.trait_type !== "string") r.fail(id, `${label}: "trait_type" is ${kind(t.trait_type)}, not a string`, src);
    if (!("trait_type" in t) && typeof t.value !== "string") r.fail(id, `${label}: without "trait_type" the value must be a string (a generic string trait)`, src);
    const v = t.value;
    if (typeof v !== "string" && typeof v !== "number") r.warn(id, `${label}: "value" is ${kind(v)}; OpenSea documents strings and numbers`, src);
    if (!("display_type" in t)) {
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) r.warn(id, `${label}: the numeric value ${JSON.stringify(v)} is quoted, so OpenSea treats it as a string trait (use a number with display_type "number" for a numeric trait)`, src);
      if ("max_value" in t) r.warn(id, `${label}: "max_value" has no effect without display_type "number"`, src);
      return;
    }
    const d = t.display_type;
    if (typeof d !== "string" || !DISPLAY_TYPES.includes(d)) return r.warn(id, `${label}: display_type ${JSON.stringify(d)} is not one of ${DISPLAY_TYPES.join(", ")}`, src);
    if (d === "date") {
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) r.fail(id, `${label}: a "date" value must be Unix time in seconds (a non-negative integer)`, src);
      else if (v > 1e11) r.warn(id, `${label}: the "date" value ${v} looks like milliseconds; OpenSea expects seconds`, src);
    } else if (typeof v !== "number") r.fail(id, `${label}: display_type "${d}" needs a numeric value, got ${kind(v)}${typeof v === "string" ? " (quoted: OpenSea treats it as a string)" : ""}`, src);
    if ("max_value" in t) {
      if (d !== "number") r.warn(id, `${label}: "max_value" applies to display_type "number" only`, src);
      else if (typeof t.max_value !== "number") r.fail(id, `${label}: "max_value" is ${kind(t.max_value)}, not a number`, src);
      else if (typeof v === "number" && v > t.max_value) r.warn(id, `${label}: value ${v} is above max_value ${t.max_value}`, src);
    }
  });
  if (r.checks.length === before) r.pass("json.attributes", `${attributes.length} attributes, each with a value in a documented shape`, "OpenSea media-and-traits");
}

/**
 * Checks an SVG's text: well-formed XML, the SVG namespace, no scripts, no external references.
 * @param {Report} r
 * @param {string} layer "image" or "art"
 * @param {string} svg
 * @param {Uint8Array} bytes
 */
function checkSvg(r, layer, svg, bytes) {
  const src = "token-uri-layout";
  let xml;
  try {
    xml = parseXml(svg);
  } catch (e) {
    if (!(e instanceof XmlError)) throw e;
    r.fail(`${layer}.xml`, `not well-formed XML: ${e.message} at ${lineCol(svg, e.at)}`, "OpenSea media-and-traits");
    return;
  }
  r.pass(`${layer}.xml`, "well-formed XML", "OpenSea media-and-traits");
  r.check(xml.root.local === "svg" && xml.root.ns === SVG_NS, `${layer}.svg_root`, `the root is <svg xmlns="${SVG_NS}">`, `the root must be <svg xmlns="${SVG_NS}">: browsers do not draw an <img> SVG without the namespace (found <${xml.root.local}> in ${JSON.stringify(xml.root.ns ?? "no namespace")})`, "OpenSea media-and-traits");
  if (xml.internalSubset) r.fail(`${layer}.no_entities`, "the DOCTYPE has an internal subset, which can declare entities: this validator does not accept it (a rule of this validator, not of XML)", "validator");
  const problems = svgReferenceProblems(xml);
  const scriptLike = problems.filter(([m]) => /^(<script>|event handler)/.test(m));
  const refs = problems.filter((p) => !scriptLike.includes(p));
  if (scriptLike.length) r.fail(`${layer}.no_script`, `${scriptLike[0][0]}${scriptLike[0][1] ? ` at ${lineCol(svg, scriptLike[0][1])}` : ""}: an SVG for NFT metadata carries no scripts, and a <script> ends the page's art block`, src);
  else r.pass(`${layer}.no_script`, "no <script> or event handler", src);
  if (refs.length) r.fail(`${layer}.self_contained`, `${refs[0][0]} at ${lineCol(svg, refs[0][1])}${refs.length > 1 ? ` (and ${refs.length - 1} more)` : ""}`, "OpenSea media-and-traits");
  else r.pass(`${layer}.self_contained`, "no external references (only #fragments and data: URIs)", "OpenSea media-and-traits");
  const art = checkArt(Buffer.from(bytes));
  r.check(art.ok, `${layer}.no_script_end_tag`, 'no "</script" in any letter case', art.lines.find((l) => l.startsWith("FAIL"))?.replace(/^FAIL /, "") ?? 'contains "</script"', src);
}

/**
 * The network references in the page outside its art block: element attributes and CSS that point
 * outside the document, and URL literals outside HTML comments.
 * @param {Report} r
 * @param {string} html the page up to the art block, as latin1
 */
function checkPageSelfContained(r, html) {
  const src = "token-uri-layout";
  // Inert data (base64 payloads) and HTML comments are not markup that loads anything.
  const text = html.replace(/<!--[\s\S]*?-->/g, "").replace(/base64,[A-Za-z0-9+/=]+/g, "base64,");
  /** @type {string[]} */
  const loads = [];
  for (const m of text.matchAll(/<[a-zA-Z][^>]*>/g)) {
    for (const a of m[0].matchAll(/\s(src|href|action|formaction|poster|data|srcset)\s*=\s*(["'])(.*?)\2/gis)) {
      if (!/^(#|data:)/i.test(a[3].trim())) loads.push(`${a[1]}="${a[3].slice(0, 60)}"`);
    }
  }
  for (const m of text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gis)) if (!/^(#|data:)/i.test(m[2].trim())) loads.push(`url(${m[2].slice(0, 60)})`);
  if (/@import/i.test(text)) loads.push("@import");
  if (loads.length) r.fail("animation.self_contained", `the page loads from outside: ${loads.slice(0, 3).join(", ")}`, src);
  else r.pass("animation.self_contained", "no element or CSS reference outside the page and data: URIs", src);
  const literals = [...text.matchAll(/\b(?:https?|wss?|ftp):\/\/[^\s"'<>)\\]+/gi)].map((m) => m[0]).filter((u) => !/^https?:\/\/www\.w3\.org\//i.test(u));
  if (literals.length) r.warn("animation.network_urls", `the page text has network URLs: ${literals.slice(0, 3).join(", ")}`, src);
  else r.pass("animation.network_urls", "no network URL in the page text", src);
}

/**
 * The player page checks: the engine and PAGE against the version's record, SETTINGS, MIDI and art.
 * @param {Report} r
 * @param {Buffer} htmlBytes
 * @param {Buffer | null} imageSvg the image, if it is an SVG data URI
 * @param {{expect?: string, version?: string}} opts
 */
function checkPlayerPage(r, htmlBytes, imageSvg, opts) {
  const html = htmlBytes.toString("latin1");
  const version = opts.version ?? VERSION;
  /** @type {Record<string, any>} */
  const versions = JSON.parse(readFileSync(PAGE_VERSIONS_PATH, "utf8"));
  const record = versions[version];
  try {
    const { gzip, engine, page } = verifyEngine(html);
    r.hashes.page_sha256 = page.sha256;
    r.hashes.engine_sha256 = engine.sha256;
    r.hashes.gzip_sha256 = gzip.sha256;
    r.sizes.page_bytes = page.length;
    r.sizes.gzip_bytes = gzip.length;
    r.sizes.engine_bytes = engine.length;
    r.pass("player.engine_inflates", "the gzip payload is canonical base64 and inflates (gzip CRC and length checked)", "verifying");
    r.info("player.page_sha256", `PAGE sha256 ${page.sha256} (${page.length} bytes)`, "verifying");
    // --expect replaces the engine comparison only; the gzip payload and PAGE are always compared
    // with the record, because a matching PAGE is what proves the shim and the player are the class's.
    if (opts.expect) {
      const expect = normalizeSha256(opts.expect);
      r.check(engine.sha256 === expect, "player.engine_sha256", `the engine's SHA-256 equals --expect (${engine.sha256})`, `the engine's SHA-256 is ${engine.sha256}, not --expect ${expect}`, "verifying");
    } else if (!record) {
      r.fail("player.engine_sha256", `scripts/page_versions.json has no record for version ${version}: pass --version or --expect`, "verifying");
    } else {
      r.check(engine.sha256 === record.script_sha256, "player.engine_sha256", `the engine's SHA-256 equals the record of ${version} (script_sha256)`, `the engine's SHA-256 is ${engine.sha256}, but the record of ${version} has ${record.script_sha256}`, "verifying");
    }
    if (record) {
      r.check(gzip.sha256 === record.gzip_sha256 && gzip.length === record.gzip_len, "player.gzip", `the gzip payload equals the record of ${version} (${gzip.length} bytes)`, `the gzip payload (${gzip.length} bytes, ${gzip.sha256}) differs from the record of ${version} (${record.gzip_len} bytes, ${record.gzip_sha256})`, "verifying");
      const other = Object.entries(versions).find(([, v]) => v.page_sha256 === page.sha256);
      r.check(page.sha256 === record.page_sha256, "player.page_sha256_record", `PAGE equals the record of ${version} (page_sha256)`, `PAGE sha256 ${page.sha256} differs from the record of ${version} (${record.page_sha256})${other ? `; it is the page of version ${other[0]}: pass --version ${other[0]}` : ""}`, "verifying");
    } else if (opts.expect) {
      r.warn("player.page_sha256_record", `scripts/page_versions.json has no record for version ${version}: the gzip payload and PAGE were not compared with any record (pass --version)`, "verifying");
    }
  } catch (e) {
    r.fail("player.page", `not this player's page: ${/** @type {Error} */ (e).message}`, "verifying");
  }
  /** @type {ReturnType<typeof splitPage>} */
  let blocks;
  try {
    blocks = splitPage(htmlBytes);
  } catch (e) {
    r.fail("player.blocks", /** @type {Error} */ (e).message, "token-uri-layout");
    return;
  }
  r.pass("player.blocks", "the settings, MIDI and art blocks follow the fixed page in that order", "token-uri-layout");
  checkPageSelfContained(r, html.slice(0, html.indexOf(ART_OPEN)));
  r.sizes.settings_bytes = blocks.settings.length;
  r.sizes.midi_base64_chars = blocks.midiB64.length;
  r.sizes.art_bytes = blocks.art.length;
  try {
    const s = decodeSettings(blocks.settings);
    validateSettings(s);
    r.pass("player.settings", `SETTINGS decodes and passes the class's checks (${blocks.settings.length} bytes, ${s.timbres.length} timbres, ${s.waves.length} waves)`, "sound-settings");
  } catch (e) {
    const err = /** @type {any} */ (e);
    r.fail("player.settings", `SETTINGS: ${err.message}${err.indices?.length ? ` [${err.indices.join(", ")}]` : ""}`, "sound-settings");
  }
  const midi = checkScore({ label: "midi", b64: blocks.midiB64 });
  if (midi.ok) {
    r.sizes.midi_bytes = midi.size ?? 0;
    r.pass("player.midi", `the MIDI passes the page's own check (${midi.size} bytes, loop ${midi.seconds.toFixed(3)} s)`, "midi-contract");
  } else r.fail("player.midi", `the MIDI fails the page's check: ${midi.error}`, "midi-contract");
  const art = checkArt(blocks.art, imageSvg ?? undefined);
  r.check(art.ok, "player.art_block", imageSvg ? "the art block equals the image, with no </script" : "the art block has no </script", art.lines.filter((l) => l.startsWith("FAIL")).map((l) => l.slice(5)).join("; "), "token-uri-layout");
  if (!imageSvg) {
    const text = utf8(blocks.art);
    if ("error" in text) r.fail("art.utf8", `the art is not UTF-8 text: ${text.error}`, "token-uri-layout");
    else checkSvg(r, "art", text.text, blocks.art);
  }
}

/**
 * Validates a token_uri (or the token JSON) and returns the report.
 * @param {{uri?: string, json?: string, felts?: number}} input
 * @param {{expect?: string, version?: string, rpcResponseBytes?: number}} [opts]
 */
export function validateTokenUri(input, opts = {}) {
  const r = new Report();
  /** @type {string | undefined} */
  let jsonText;
  if (input.uri !== undefined) {
    const uri = input.uri;
    r.sizes.token_uri_bytes = uri.length;
    r.sizes.rpc_response_estimated = Math.ceil(uri.length / 31) * WORD_CHARS;
    if (input.felts !== undefined) r.pass("input.bytearray", `the felts decode to one ByteArray (${input.felts - 3} full words, ${uri.length} bytes)`, "validator");
    const nonAscii = uri.search(/[^\x21-\x7e]/);
    if (nonAscii >= 0) {
      r.fail("token_uri.ascii", `byte ${nonAscii} is not printable ASCII (whitespace and non-ASCII do not belong in a token_uri)`, "OpenSea metadata-storage");
    } else r.pass("token_uri.ascii", "printable ASCII", "OpenSea metadata-storage");
    if (!uri.startsWith(JSON_PREFIX)) {
      r.fail("token_uri.prefix", `does not start with ${JSON_PREFIX} (starts with ${JSON.stringify(uri.slice(0, 40))})`, "OpenSea metadata-storage");
    } else {
      r.pass("token_uri.prefix", `starts with ${JSON_PREFIX}`, "OpenSea metadata-storage");
      const payload = uri.slice(JSON_PREFIX.length);
      const problem = base64Problem(payload);
      if (problem) r.fail("token_uri.base64", `the JSON layer is not canonical standard base64: ${problem} (offset counted from the end of the prefix, ${JSON_PREFIX.length} characters in)`, "OpenSea metadata-storage");
      else {
        r.pass("token_uri.base64", "the JSON layer is canonical standard base64", "OpenSea metadata-storage");
        const bytes = Buffer.from(payload, "base64");
        r.sizes.json_bytes = bytes.length;
        const text = utf8(bytes);
        if ("error" in text) r.fail("token_uri.utf8", `the JSON is not UTF-8: ${text.error}`, "ERC-721");
        else {
          r.pass("token_uri.utf8", "the JSON is valid UTF-8", "ERC-721");
          jsonText = text.text;
        }
      }
    }
  } else jsonText = input.json;
  if (jsonText === undefined) return finish(r, opts);
  if (jsonText.charCodeAt(0) === 0xfeff) r.fail("json.parse", "the JSON starts with a byte order mark", "ERC-721");
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(jsonText);
    if (jsonText.charCodeAt(0) !== 0xfeff) r.pass("json.parse", "valid JSON", "ERC-721");
  } catch (e) {
    r.fail("json.parse", `invalid JSON: ${/** @type {Error} */ (e).message}`, "ERC-721");
    return finish(r, opts);
  }
  checkFields(r, json);
  if (!isObject(json)) return finish(r, opts);
  const o = /** @type {Record<string, unknown>} */ (json);

  /** @type {Buffer | null} */
  let imageSvg = null;
  if (typeof o.image === "string") {
    const image = o.image;
    r.sizes.image_data_uri_bytes = image.length;
    if (image.startsWith(SVG_PREFIX)) {
      const payload = image.slice(SVG_PREFIX.length);
      const problem = base64Problem(payload);
      if (problem) r.fail("image.base64", `"image" is not canonical standard base64: ${problem} (offset counted after ${SVG_PREFIX})`, "OpenSea metadata-storage");
      else {
        const bytes = Buffer.from(payload, "base64");
        r.sizes.image_bytes = bytes.length;
        const text = utf8(bytes);
        if ("error" in text) r.fail("image.utf8", `the SVG is not UTF-8: ${text.error}`, "OpenSea media-and-traits");
        else {
          imageSvg = bytes;
          r.pass("image.base64", `"image" is an SVG data URI (${bytes.length} bytes decoded)`, "OpenSea media-and-traits");
          checkSvg(r, "image", text.text, bytes);
          if (bytes.length > IMAGE_WARN) r.warn("image.size", `the SVG is ${bytes.length} bytes: OpenSea rasterizes it and every marketplace fetches it through the same capped response`, "validator");
        }
      }
    } else if (/^data:image\/(png|jpeg|gif|webp)/i.test(image)) {
      r.warn("image.type", "the image is a raster data URI: the SVG checks are skipped", "OpenSea media-and-traits");
    } else if (/^(https?|ipfs|ar):\/\//i.test(image)) {
      r.warn("image.type", "the image is an external URL, not an onchain SVG: the SVG checks are skipped and the token is not self-contained", "OpenSea media-and-traits");
    } else r.fail("image.type", `the image ${JSON.stringify(image.slice(0, 40))} is neither an image data URI nor a URL`, "OpenSea media-and-traits");
  }

  if (!("animation_url" in o)) r.fail("animation.present", 'no "animation_url": this validator checks tokens that carry the player page', "token-uri-layout");
  else if (typeof o.animation_url !== "string") r.fail("animation.present", `"animation_url" is ${kind(o.animation_url)}, not a string`, "OpenSea media-and-traits");
  else {
    const url = o.animation_url;
    r.sizes.animation_data_uri_bytes = url.length;
    if (!url.startsWith(HTML_PREFIX)) {
      r.fail("animation.prefix", `"animation_url" does not start with ${HTML_PREFIX} (it starts with ${JSON.stringify(url.slice(0, 40))}); OpenSea also accepts GLTF, GLB, WEBM, MP4 and audio, but the player is an HTML page`, "OpenSea media-and-traits");
    } else {
      const problem = base64Problem(url.slice(HTML_PREFIX.length));
      if (problem) r.fail("animation.base64", `"animation_url" is not canonical standard base64: ${problem} (offset counted after ${HTML_PREFIX})`, "token-uri-layout");
      else {
        const html = Buffer.from(url.slice(HTML_PREFIX.length), "base64");
        r.sizes.animation_html_bytes = html.length;
        r.pass("animation.base64", `"animation_url" is an HTML data URI (${html.length} bytes decoded; OpenSea shows an HTML page in a sandboxed iframe)`, "OpenSea media-and-traits");
        const text = utf8(html);
        if ("error" in text) r.fail("animation.utf8", `the page is not UTF-8: ${text.error}`, "token-uri-layout");
        checkPlayerPage(r, html, imageSvg, opts);
      }
    }
  }
  return finish(r, opts);
}

/**
 * Adds the size checks and returns the report.
 * @param {Report} r
 * @param {{rpcResponseBytes?: number}} opts
 */
function finish(r, opts) {
  if (opts.rpcResponseBytes !== undefined) r.sizes.rpc_response_bytes = opts.rpcResponseBytes;
  const size = r.sizes.rpc_response_bytes ?? r.sizes.rpc_response_estimated;
  if (size !== undefined) {
    r.sizes.rpc_cap_bytes = RPC_CAP;
    const how = r.sizes.rpc_response_bytes !== undefined ? "measured" : "estimated";
    const pct = `${((100 * size) / RPC_CAP).toFixed(1)}% of the 10 MiB cap`;
    if (size > RPC_CAP) r.fail("size.rpc", `the JSON-RPC response (${how}) is ${size} bytes: over the 10 MiB cap of jsonrpsee nodes`, "gas limits");
    else if (size > RPC_WARN) r.warn("size.rpc", `the JSON-RPC response (${how}) is ${size} bytes, ${pct}`, "gas limits");
    else r.pass("size.rpc", `the JSON-RPC response (${how}) is ${size} bytes, ${pct}`, "gas limits");
  }
  return r;
}

// ---------------------------------------------------------------------------------------------
// Fetching through RPC
// ---------------------------------------------------------------------------------------------

/**
 * Calls `token_uri` (then `tokenURI`, if the contract has no such entry point) with starknet_call.
 * Errors never contain the RPC URL, which may carry an API key.
 * @param {{rpc: string, contract: string, token: string, fetchImpl?: typeof fetch}} p
 * @returns {Promise<{uri: string, felts: number, responseBytes: number}>}
 */
export async function fetchTokenUri({ rpc, contract, token, fetchImpl = fetch }) {
  const id = BigInt(token);
  if (id < 0n || id >= 1n << 256n) throw new Error("--token is not a u256");
  const calldata = ["0x" + (id & ((1n << 128n) - 1n)).toString(16), "0x" + (id >> 128n).toString(16)];
  const clean = (/** @type {string} */ s) => {
    let out = s.split(rpc).join("<rpc>");
    try {
      out = out.split(new URL(rpc).host).join("<rpc host>");
    } catch {
      // not a URL: it is rejected by fetch below
    }
    return out;
  };
  let last = "";
  for (const name of ["token_uri", "tokenURI"]) {
    let text;
    try {
      const res = await fetchImpl(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "starknet_call", params: { request: { contract_address: contract, entry_point_selector: selector(name), calldata }, block_id: "latest" } }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`the RPC answered HTTP ${res.status}`);
      text = await res.text();
    } catch (e) {
      const err = /** @type {any} */ (e);
      throw new Error(err.message?.startsWith("the RPC answered") ? err.message : `the RPC request failed (${err.cause?.code ?? err.name})`);
    }
    let doc;
    try {
      doc = JSON.parse(text);
    } catch {
      throw new Error("the RPC response is not JSON");
    }
    if (doc.error) {
      last = clean(`${doc.error.message ?? "error"} (code ${doc.error.code}) ${doc.error.data ? JSON.stringify(doc.error.data) : ""}`.trim());
      const reasons = shortStrings(doc.error);
      if (name === "token_uri" && (doc.error.code === 21 || reasons.includes("ENTRYPOINT_NOT_FOUND") || /ENTRYPOINT_NOT_FOUND/.test(last))) continue;
      throw new Error(`starknet_call failed: ${last}${reasons.length ? `\nrevert reason: ${reasons.join(", ")}` : ""}`);
    }
    if (!Array.isArray(doc.result)) throw new Error("the RPC response has no result array");
    return { uri: byteArrayFromFelts(doc.result).toString("latin1"), felts: doc.result.length, responseBytes: Buffer.byteLength(text) };
  }
  throw new Error(`starknet_call failed: ${last}`);
}

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

const USAGE = `usage: node scripts/validate_token_uri.mjs <token_uri file | -> [--expect <script_sha256>] [--version <semver>] [--json]
       node scripts/validate_token_uri.mjs --contract <address> --token <id> [--rpc <url> | STARKNET_RPC_URL] [same options]`;

/**
 * The report as text.
 * @param {ReturnType<Report["toJSON"]>} j
 */
export function formatReport(j) {
  const lines = [];
  const layers = [...new Set(j.checks.map((c) => c.id.split(".")[0]))];
  for (const layer of layers) {
    lines.push(`${layer}:`);
    for (const c of j.checks.filter((c) => c.id.startsWith(`${layer}.`))) lines.push(`  ${c.level.toUpperCase().padEnd(4)} ${c.id.padEnd(28)} ${c.message}  [${c.source}]`);
  }
  const s = j.sizes;
  const sizes = Object.entries(s).filter(([k]) => k !== "rpc_cap_bytes").map(([k, v]) => `  ${k.padEnd(28)} ${v}`);
  lines.push("sizes (bytes unless named):", ...sizes);
  lines.push(`${j.ok ? "PASS" : "FAIL"}: ${j.summary.pass} passed, ${j.summary.warn} warnings, ${j.summary.fail} failed`);
  return lines.join("\n");
}

/**
 * Runs the command line and returns the exit status.
 * @param {string[]} argv
 * @param {(line: string) => void} [out]
 * @param {(line: string) => void} [err]
 * @returns {Promise<number>}
 */
export async function run(argv, out = console.log, err = console.error) {
  /** @type {Record<string, string | boolean>} */
  const opt = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opt.json = true;
    else if (["--rpc", "--contract", "--token", "--expect", "--version"].includes(a)) {
      if (argv[i + 1] === undefined) {
        err(`${a} needs a value\n${USAGE}`);
        return 2;
      }
      opt[a.slice(2)] = argv[++i];
    } else if (a.startsWith("--")) {
      err(`unknown option ${a}\n${USAGE}`);
      return 2;
    } else pos.push(a);
  }
  const rpc = /** @type {string | undefined} */ (opt.rpc) ?? process.env.STARKNET_RPC_URL;
  const fetching = opt.contract !== undefined || opt.token !== undefined || opt.rpc !== undefined;
  if (pos.length + (fetching ? 1 : 0) !== 1 || (fetching && (!rpc || opt.contract === undefined || opt.token === undefined))) {
    err(USAGE);
    return 2;
  }
  /** @type {{uri?: string, json?: string, felts?: number}} */
  let input;
  /** @type {number | undefined} */
  let rpcResponseBytes;
  try {
    if (fetching) {
      const f = await fetchTokenUri({ rpc: /** @type {string} */ (rpc), contract: /** @type {string} */ (opt.contract), token: /** @type {string} */ (opt.token) });
      input = { uri: f.uri, felts: f.felts };
      rpcResponseBytes = f.responseBytes;
    } else input = parseInput(readFileSync(pos[0] === "-" ? 0 : pos[0]));
  } catch (e) {
    err(`ERROR ${String(/** @type {Error} */ (e).message)}`);
    return 2;
  }
  let report;
  try {
    report = validateTokenUri(input, { expect: /** @type {string | undefined} */ (opt.expect), version: /** @type {string | undefined} */ (opt.version), rpcResponseBytes }).toJSON();
  } catch (e) {
    err(`ERROR ${String(/** @type {Error} */ (e).message)}`);
    return 2;
  }
  out(opt.json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await run(process.argv.slice(2));
