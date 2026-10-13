// @ts-check
// The pinned TinySynth engine: the Provable-Games fork's own minified build
// (webaudio-tinysynth.min.js) and NOTICE at one commit, vendored in tests/vendor so that the page
// build and the tests run offline. It is the engine embedded in player_segment() (scripts/build_segments.mjs) and
// the one the engine tests and render checks run. Both files are SHA-256 checked on every load, so
// any mismatch fails before anything is generated.
//
// Re-pinning updates ENGINE_PIN and verified ENGINE_BUILD identities, after vendoring files with
//   node scripts/vendor_engine.mjs <fork checkout> <commit or tag>
// which prints the new line. `ref` names the vendored files and is recorded with the VERSION in
// scripts/library_versions.json; it is the short commit SHA or, for a tagged fork release,
// the tag. Changes to recorded provenance/artifacts normally require a new VERSION.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Signed fork release v2.0.1 of pocket-synth (tag commit 4b82969 on main). The fork's release PR #111 built
// and committed the minified script and map on release/v2.0.1 (c17c742), and that PR's CI run checked them
// against a fresh build; the tag carries the identical source, NOTICE, script and map. The lock below is
// c17c742's, which that CI build used; the tag's differs only in test-only playwright-core, and a fresh
// `npm ci` build of the tag reproduces both files.
export const ENGINE_PIN = { ref: "v2.0.1", commit: "4b829693d112d27e4dfaeb126d1912ff89216324", sha256: "8ffa2519cdd0ac9c4876101681014e39cbfd07e71d45ea1fa5dc15d53233f94b", noticeSha256: "0e4f6ad003a1cf9e2ea2620b57a8a7eec4b396064e222316782b70cb6693652b" };
export const ENGINE_BUILD = {
  provisional: false,
  sourceCommit: "c17c7427031f489f27d11d83d5502c1d4746fa77",
  distributionCommit: "c17c7427031f489f27d11d83d5502c1d4746fa77",
  ciRun: "https://github.com/Provable-Games/pocket-synth/actions/runs/38368777784",
  sourceMapSha256: "0afc9143aff436bdb165619f8f8229ca3ac9d87529f00ff1dbbd420e6c762f6a",
  sourceSha256: "a741647d1b6e4c94a7630da5b0b457377879f37f17971f4b42f704f1244839e0",
  recipe: "node scripts/build.js <output-dir>",
  recipeSha256: "ec9bbbf2adc1da286af30698fa1889d71142e95b88a83b2d94c2b9fc82f51728",
  packageLockSha256: "8e929f89b90456fcc607b9396d80d465deffd8f915a6a2c963901883175ae5b0",
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
