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

// Signed fork release v2.1.0 of pocket-synth (tag commit 92e3bef on main, the merge of release PR #124). That
// PR built and committed the minified script and map on release/v2.1.0 (a5b5c98), and its CI run checked them
// against a fresh build; the tag commit has the identical tree, so the same source, NOTICE, lock, script and
// map. A fresh `npm ci` build of the tag reproduces both files.
export const ENGINE_PIN = { ref: "v2.1.0", commit: "92e3bef0eac09a5ccbdaca2b07f6ba348c2f1cd2", sha256: "9be3f30479321274aff644a0a5d1ab8aa0e431f9f8e9a2548cdd89f72c4281b4", noticeSha256: "57e35bc6d5e34f54efccfdfe4c50a695679810ac586fb24d7d1242bfb07067df" };
export const ENGINE_BUILD = {
  provisional: false,
  sourceCommit: "a5b5c98716d390542738d87b29d1cc5664316081",
  distributionCommit: "a5b5c98716d390542738d87b29d1cc5664316081",
  ciRun: "https://github.com/Provable-Games/pocket-synth/actions/runs/40908453483",
  sourceMapSha256: "e740c2f5284bf6c769e25299c33ae7b5040c82e0da54ba4c0ccd5990662a5d14",
  sourceSha256: "da9bd2ea7391ab83159514c518ae9bc9968bc233de5a621d103b492e4c836f28",
  recipe: "node scripts/build.js <output-dir>",
  recipeSha256: "ec9bbbf2adc1da286af30698fa1889d71142e95b88a83b2d94c2b9fc82f51728",
  packageLockSha256: "e804530bd5702682ec68a33763ec3677999ea2d8b5f31121d26698aced7bf525",
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
