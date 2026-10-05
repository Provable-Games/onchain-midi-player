#!/usr/bin/env node
// @ts-check
// Turns the result of a `token_uri` call into the token_uri string. Node built-ins only.
//
// Usage: node bytearray.mjs <call.json | -> > token_uri.txt
//
// The input is either the JSON-RPC response of a raw `starknet_call`, whose result is a Cairo
// ByteArray as felts ([full word count, 31-byte words..., pending word, pending length]), or the
// output of `sncast --json call` (with its stderr, where it reports errors), whose "response" holds
// the decoded string. The string is written to standard output as its exact bytes. For an error
// response (a revert, such as a provider's "Out of gas"), it prints the error with any short strings
// in it decoded, and exits 1.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A ByteArray's bytes from its serialized felts.
 * @param {Array<string | number | bigint>} felts
 * @returns {Buffer}
 */
export function byteArrayFromFelts(felts) {
  const f = felts.map((x) => BigInt(x));
  const words = Number(f[0]);
  if (f.length !== words + 3) throw new Error(`not one ByteArray: ${f.length} felts for ${words} full words`);
  /** @param {bigint} x @param {number} len */
  const word = (x, len) => {
    if (len === 0 && x === 0n) return Buffer.alloc(0);
    const hex = x.toString(16).padStart(len * 2, "0");
    if (hex.length > len * 2) throw new Error(`a word longer than ${len} bytes`);
    return Buffer.from(hex, "hex");
  };
  const pending = Number(f[words + 2]);
  if (pending > 30) throw new Error(`pending length ${pending}`);
  return Buffer.concat([...f.slice(1, words + 1).map((w) => word(w, 31)), word(f[words + 1], pending)]);
}

/**
 * Felts in an error that read as Cairo short strings (printable ASCII), such as a revert reason.
 * @param {unknown} error
 * @returns {string[]}
 */
export function shortStrings(error) {
  const found = [];
  for (const [hex] of JSON.stringify(error).matchAll(/0x[0-9a-fA-F]{2,62}\b/g)) {
    const bytes = Buffer.from(hex.slice(2).padStart(hex.length - 2 + (hex.length % 2), "0"), "hex");
    if (bytes.length && bytes.every((b) => b >= 0x20 && b < 0x7f)) found.push(bytes.toString("latin1"));
  }
  return found;
}

/**
 * The token_uri bytes from a call's JSON output (raw starknet_call or sncast --json). Throws with a
 * readable message for an error response.
 * @param {string} text
 * @returns {Buffer}
 */
export function tokenUriFromCall(text) {
  // One JSON document, or one per line (sncast --json with stderr redirected may add other lines).
  const docs = [];
  try {
    docs.push(JSON.parse(text));
  } catch {
    // not a single document
  }
  for (const line of docs.length ? [] : text.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      docs.push(JSON.parse(line));
    } catch {
      // not a JSON line
    }
  }
  const doc = docs.find((d) => d && (d.result !== undefined || d.response !== undefined || d.error !== undefined));
  if (!doc) throw new Error(text.trim() ? "no starknet_call result or sncast response in the input" : "empty input: did the call fail? See its error output");
  if (doc.error) {
    const reasons = shortStrings(doc.error);
    throw new Error(`call failed: ${JSON.stringify(doc.error)}${reasons.length ? `\nrevert reason: ${reasons.join(", ")}` : ""}`);
  }
  if (Array.isArray(doc.result)) return byteArrayFromFelts(doc.result);
  if (typeof doc.response === "string") {
    const value = JSON.parse(doc.response);
    if (typeof value !== "string") throw new Error("sncast response is not a string");
    return Buffer.from(value, "latin1");
  }
  throw new Error("no starknet_call result or sncast response in the input");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [src] = process.argv.slice(2);
  if (!src) {
    console.error("usage: node bytearray.mjs <call.json | -> > token_uri.txt");
    process.exit(2);
  }
  try {
    process.stdout.write(tokenUriFromCall(readFileSync(src === "-" ? 0 : src, "utf8")));
  } catch (e) {
    console.error(String(/** @type {Error} */ (e).message));
    process.exitCode = 1;
  }
}
