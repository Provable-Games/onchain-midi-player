#!/usr/bin/env node
// @ts-check
// Checks the TinySynth engine inside a token's animation_url page (README: "Verifying the engine").
// Node built-ins only, and no imports from this repository, so a collector can copy this one file
// and run it with Node 22 or later.
//
// Usage: node scripts/verify_engine.mjs <file | -> [--expect <script_sha256>]
//
// The input (a file, or stdin with "-") is any of:
//   - a token_uri: data:application/json;base64,...
//   - the token JSON, decoded
//   - an animation_url: data:text/html;base64,...
//   - the animation_url page, decoded (or the class's fixed page, tests/fixtures/page.html)
//
// It takes the one <script type="text/javascript+gzip" src="data:text/javascript;base64,..."> tag of
// the fixed page (PAGE: everything up to the settings block and its alignment spaces; the token's
// settings, MIDI and art follow it as raw text, so they are never searched), base64-decodes its
// payload (strictly), gunzips it (which checks the gzip CRC-32 and length) and prints the SHA-256 and
// length of:
//   - the gzip payload: page_data::GZIP_SHA256 and GZIP_LEN;
//   - the engine it inflates to: script_sha256(), and the fork's webaudio-tinysynth.min.js;
//   - the fixed page: scripts/page_versions.json. A matching fixed page proves the rest: that the
//     tag is the page's own engine tag, not text in a comment, and that the shim and the player
//     around it are the class's.
// Compare them with the README's "Versions" table. With --expect, it exits 1 unless the engine's
// SHA-256 equals the given value: hex, with or without 0x, as script_sha256() prints it.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const JSON_PREFIX = "data:application/json;base64,";
const HTML_PREFIX = "data:text/html;base64,";
const GZIP_TAG = /<script type="text\/javascript\+gzip" src="data:text\/javascript;base64,([^"]*)"/g;
const SETTINGS_OPEN = '<script type="text/plain" id="settings">';

/** SHA-256 as lowercase hex. */
const sha256 = (/** @type {Uint8Array} */ bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * Strict base64: rejects anything that is not canonical standard base64 (Node's decoder would
 * silently skip it).
 * @param {string} s
 * @param {string} what
 */
function strictBase64(s, what) {
  const bytes = Buffer.from(s, "base64");
  if (bytes.toString("base64") !== s) throw new Error(`${what} is not canonical standard base64`);
  return bytes;
}

/**
 * The page HTML (as a latin1 string, one character per byte) from any of the accepted inputs.
 * @param {Buffer} input
 */
export function pageFromInput(input) {
  const raw = input.toString("latin1");
  let text = raw.trim();
  let json = null;
  if (text.startsWith(JSON_PREFIX)) {
    json = new TextDecoder("utf-8", { fatal: true }).decode(strictBase64(text.slice(JSON_PREFIX.length), "the token_uri"));
  } else if (text.startsWith("{")) {
    json = input.toString("utf8");
  }
  if (json !== null) {
    const url = JSON.parse(json).animation_url;
    if (typeof url !== "string") throw new Error("the token JSON has no animation_url string");
    text = url;
  }
  if (text.startsWith(HTML_PREFIX)) return strictBase64(text.slice(HTML_PREFIX.length), "the animation_url").toString("latin1");
  if (text.startsWith("data:")) throw new Error(`unsupported data URI: ${text.slice(0, 40)}`);
  // The HTML itself, untrimmed: a page ends with alignment spaces.
  return raw;
}

/**
 * The SHA-256 and length of the gzip payload, the engine and the fixed page in a page's HTML.
 * Throws if the page has no settings block, if its fixed part has no or several gzip tags outside
 * HTML comments, or if the payload does not inflate.
 * @param {string} html latin1 string, one character per byte
 */
export function verifyEngine(html) {
  // PAGE ends with the settings block's opening tag and its alignment spaces; D follows with digits.
  const settings = html.indexOf(SETTINGS_OPEN);
  if (settings < 0) throw new Error("no settings block: not an onchain-midi-player page");
  let end = settings + SETTINGS_OPEN.length;
  while (html[end] === " ") end++;
  const page = Buffer.from(html.slice(0, end), "latin1");
  // Only the fixed page is markup with the engine's tag; a tag inside an HTML comment does not run.
  const head = html.slice(0, settings);
  const inComment = (/** @type {number} */ at) => head.lastIndexOf("<!--", at) > head.lastIndexOf("-->", at);
  const tags = [...head.matchAll(GZIP_TAG)].filter((m) => !inComment(m.index));
  if (tags.length !== 1) throw new Error(`expected one text/javascript+gzip script tag in the fixed page, found ${tags.length}`);
  const payload = strictBase64(tags[0][1], "the gzip payload");
  const engine = gunzipSync(payload);
  /** @param {Uint8Array} b */
  const digest = (b) => ({ sha256: sha256(b), length: b.length });
  return { gzip: digest(payload), engine: digest(engine), page: digest(page) };
}

/**
 * A SHA-256 given as hex (with or without 0x, any case, leading zeros optional: a u256 printed as
 * hex), as 64 lowercase hex digits.
 * @param {string} s
 */
export function normalizeSha256(s) {
  const hex = s.trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{1,64}$/.test(hex)) throw new Error(`not a SHA-256 in hex: ${s}`);
  return hex.padStart(64, "0");
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--expect");
  const expect = at < 0 ? null : normalizeSha256(args.splice(at, 2)[1] ?? "");
  if (args.length !== 1) {
    console.error("usage: node scripts/verify_engine.mjs <token_uri, token JSON, animation_url or page file | -> [--expect <script_sha256>]");
    process.exit(2);
  }
  const { gzip, engine, page } = verifyEngine(pageFromInput(readFileSync(args[0] === "-" ? 0 : args[0])));
  console.log(`gzip payload  sha256 ${gzip.sha256}  ${gzip.length} bytes`);
  console.log(`engine        sha256 ${engine.sha256}  ${engine.length} bytes`);
  console.log(`fixed page    sha256 ${page.sha256}  ${page.length} bytes`);
  if (expect !== null) {
    if (engine.sha256 !== expect) {
      console.error(`MISMATCH: the engine's SHA-256 is not ${expect}`);
      process.exit(1);
    }
    console.log("the engine's SHA-256 matches");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
