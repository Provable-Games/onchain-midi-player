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

// Signed fork release v2.1.2 of pocket-synth (tag commit 4a2dc1c on main, the merge of release PR #128). That
// PR built and committed the minified script and map on release/v2.1.2 (f1276f0), and its CI run checked them
// against a fresh build; the tag commit has the identical tree, so the same source, NOTICE, lock, script and
// map. A fresh `npm ci` build of the tag reproduces both files.
export const ENGINE_PIN = { ref: "v2.1.2", commit: "4a2dc1cd7e43e9a8df26dd3e96f41eed62e2c9b9", sha256: "1cc2fe98bdd9c8ae0d030d00f5b5350f139a4062a314176f07ca4b820debe4f4", noticeSha256: "6ff04a5bc4e832ce90f2e3c033eacb68777d58bfc66708f2347a2e059d614595" };
// Audit trust anchor; review a signer change when re-pinning. This does not
// alter the embedded engine or its generated provenance manifest.
export const ENGINE_RELEASE_SIGNER = "B3B5E2A6C50C29F90A868653CD7025F6005367A5";
export const ENGINE_BUILD = {
  provisional: false,
  sourceCommit: "f1276f041271d392f7043e47c0a1b12438a6e572",
  distributionCommit: "f1276f041271d392f7043e47c0a1b12438a6e572",
  ciRun: "https://github.com/Provable-Games/pocket-synth/actions/runs/41020790486",
  sourceMapSha256: "15a3a957614d8c29445692d2b8ad3524ccf9eb4748200697e62019233913752e",
  sourceSha256: "b53678d784d85f16b1bb6fbcb7cd50277df6192ec011e79940e8a8d5bb7d06d0",
  recipe: "node scripts/build.js <output-dir>",
  recipeSha256: "ec9bbbf2adc1da286af30698fa1889d71142e95b88a83b2d94c2b9fc82f51728",
  packageLockSha256: "dd87c94ac3137b2d0ca8187868066da31f193fe8c3432bf20013bda6e51537e8",
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
