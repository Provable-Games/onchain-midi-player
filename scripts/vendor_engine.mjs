#!/usr/bin/env node
// @ts-check
// Vendors a TinySynth fork build for re-pinning: copies webaudio-tinysynth.min.js and NOTICE at a
// commit or tag of a local fork checkout into tests/vendor, and prints the ENGINE_PIN line to put in
// scripts/engine.mjs. Reads the checkout with `git show` only; needs no network and changes nothing
// in the checkout.
//
// Usage: node scripts/vendor_engine.mjs <fork checkout> <commit or tag>
//
// Before pinning, check that the minified file is the fork's own reproducible build of that ref
// (check out the ref, run `npm ci && npm run build`, compare), as tests/vendor/README.md describes.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { VENDOR_DIR, sha256Hex } from "./engine.mjs";

const [fork, ref] = process.argv.slice(2);
if (!fork || !ref) {
  console.error("usage: node scripts/vendor_engine.mjs <fork checkout> <commit or tag>");
  process.exit(2);
}
const git = (/** @type {string[]} */ ...args) => execFileSync("git", ["-C", fork, ...args], { maxBuffer: 1 << 26 });
const commit = git("rev-parse", "--verify", `${ref}^{commit}`).toString().trim();
// A tag names itself; a commit is named by its 7-character short SHA.
const isTag = git("tag", "--list", ref).toString().trim() === ref;
const label = isTag ? ref : commit.slice(0, 7);
if (!/^[0-9A-Za-z._-]{1,16}$/.test(label)) throw new Error(`ref label ${JSON.stringify(label)} must be 1-16 of [0-9A-Za-z._-] (it names the vendored files and is recorded in scripts/page_versions.json)`);
const engine = git("show", `${commit}:webaudio-tinysynth.min.js`);
const notice = git("show", `${commit}:NOTICE`);
writeFileSync(join(VENDOR_DIR, `webaudio-tinysynth-${label}.min.js`), engine);
writeFileSync(join(VENDOR_DIR, `webaudio-tinysynth-${label}.NOTICE`), notice);
console.log(`vendored ${label} (${commit}): engine ${engine.length} bytes, NOTICE ${notice.length} bytes`);
console.log("Replace the ENGINE_PIN line in scripts/engine.mjs with:\n");
console.log(`export const ENGINE_PIN = ${JSON.stringify({ ref: label, commit, sha256: sha256Hex(engine), noticeSha256: sha256Hex(notice) })
  .replace(/"(\w+)":/g, "$1: ").replace(/,/g, ", ").replace(/^\{/, "{ ").replace(/\}$/, " }")};`);
