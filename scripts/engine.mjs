// @ts-check
// The pinned TinySynth engine: the Provable-Games fork's own minified build
// (webaudio-tinysynth.min.js) and NOTICE at one commit, vendored in tests/vendor so that the page
// build and the tests run offline. It is the engine embedded in player_segment() (scripts/build_segments.mjs) and
// the one the engine tests and render checks run. Both files are SHA-256 checked on every load, so
// any mismatch fails before anything is generated.
//
// Re-pinning is a one-line change to ENGINE_PIN, after vendoring the new files with
//   node scripts/vendor_engine.mjs <fork checkout> <commit or tag>
// which prints the new line. `ref` names the vendored files and is recorded with the VERSION in
// scripts/library_versions.json; it is the short commit SHA or, once the fork publishes tagged releases,
// the tag. A re-pin needs a new VERSION (scripts/segments.mjs).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// PROVISIONAL: local build of source-only upstream draft dependency; repin to its post-merge CI build before marking #62 ready.
export const ENGINE_PIN = { ref: "dev-748d777", commit: "748d777ae895e9e07cc84b13012c0fdb586b5c3f", sha256: "df839b0d8b0479e799b2b19bdf5c714d92287a501d9d026335a0854ad491da65", noticeSha256: "9b4effe6aa89960e79172b20469634f905857fdd3b63e97ec5055349b2a23708" };
export const ENGINE_BUILD = {
  provisional: true,
  sourceCommit: ENGINE_PIN.commit,
  sourceSha256: "8ca7fa60212ac58649337c507549b985f12c238da2c003aae3e0ee5db7109fb7",
  recipe: "node scripts/build.js <output-dir>",
  recipeSha256: "ec9bbbf2adc1da286af30698fa1889d71142e95b88a83b2d94c2b9fc82f51728",
  packageLockSha256: "67402d41acd7d49ed3c1a1f689e7f91a81bff1b7dc1727b355d1d3b3dec4197d",
  terser: "5.51.2"
};

export const ENGINE_COMMIT = ENGINE_PIN.commit;
export const ENGINE_SHA256 = ENGINE_PIN.sha256;
export const VENDOR_DIR = join(dirname(fileURLToPath(import.meta.url)), "../tests/vendor");
export const ENGINE_PATH = join(VENDOR_DIR, `webaudio-tinysynth-${ENGINE_PIN.ref}.min.js`);
export const NOTICE_PATH = join(VENDOR_DIR, `webaudio-tinysynth-${ENGINE_PIN.ref}.NOTICE`);

/** SHA-256 of some bytes, as lowercase hex. */
export const sha256Hex = (/** @type {Buffer | string} */ bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * A vendored file's bytes, after checking its SHA-256.
 * @param {string} path
 * @param {string} expected
 */
function pinned(path, expected) {
  const bytes = readFileSync(path);
  const hash = sha256Hex(bytes);
  if (hash !== expected) throw new Error(`${path}: sha256 ${hash}, expected ${expected} (ENGINE_PIN in scripts/engine.mjs)`);
  return bytes;
}

/** The engine's source: exactly the pinned file's bytes (ASCII), after checking its SHA-256. */
export function engineSource() {
  return pinned(ENGINE_PATH, ENGINE_PIN.sha256).toString("utf8");
}

/** The fork's NOTICE at the pinned commit (its list of modifications), after checking its SHA-256. */
export function engineNotice() {
  return pinned(NOTICE_PATH, ENGINE_PIN.noticeSha256).toString("utf8");
}
