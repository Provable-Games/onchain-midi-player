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
// scripts/library_versions.json; it is the short commit SHA or, once the fork publishes tagged releases,
// the tag. Changes to recorded provenance/artifacts normally require a new VERSION.
// The unissued 0.6.0 development-record replacement is documented in docs/development.md.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Post-merge fork distribution build, reproducibly verified against its pinned source/recipe/lock.
export const ENGINE_PIN = { ref: "2cb8b40", commit: "2cb8b405ede0d91a431f3ef3e4175f0bf3b0c18a", sha256: "df839b0d8b0479e799b2b19bdf5c714d92287a501d9d026335a0854ad491da65", noticeSha256: "9b4effe6aa89960e79172b20469634f905857fdd3b63e97ec5055349b2a23708" };
export const ENGINE_BUILD = {
  provisional: false,
  sourceCommit: "8fd8b94c8bb1fd2df3d144404620520c4b7f3725",
  distributionCommit: ENGINE_PIN.commit,
  ciRun: "https://github.com/Provable-Games/webaudio-tinysynth/actions/runs/38269640215",
  sourceMapSha256: "55d24636b60db7a6b7d16b557dc7eb89a387580ce2978d8d10e9054ef33ce60c",
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
