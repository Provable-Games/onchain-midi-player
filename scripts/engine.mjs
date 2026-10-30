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

// Signed fork release v2.1.1 of pocket-synth (tag commit e0b1a89 on main, the merge of release PR #126). That
// PR built and committed the minified script and map on release/v2.1.1 (fbe394e), and its CI run checked them
// against a fresh build; the tag commit has the identical tree, so the same source, NOTICE, lock, script and
// map. A fresh `npm ci` build of the tag reproduces both files.
export const ENGINE_PIN = { ref: "v2.1.1", commit: "e0b1a897f34968ba3ecfad3fddfbac815499c9c0", sha256: "b0be448e3c0959862e1f83f3b22c0550dc27d13094757430bf2ed4a28a28ceed", noticeSha256: "ff3f337c324f6522c6831fe096076d6eba672ef03e40608a5fcf1bf59dd3fca0" };
export const ENGINE_BUILD = {
  provisional: false,
  sourceCommit: "fbe394e86fa7ba2e2581aad018e94b10eadc52e1",
  distributionCommit: "fbe394e86fa7ba2e2581aad018e94b10eadc52e1",
  ciRun: "https://github.com/Provable-Games/pocket-synth/actions/runs/41007922128",
  sourceMapSha256: "ad9b593c7479daa1f084df860b67158484255287c8a0dc1726b3da6ba5896d9e",
  sourceSha256: "b45380199b6f1703aff12e5dd37ca74f2f35f265c23841145bd4a9bdae20ff2b",
  recipe: "node scripts/build.js <output-dir>",
  recipeSha256: "ec9bbbf2adc1da286af30698fa1889d71142e95b88a83b2d94c2b9fc82f51728",
  packageLockSha256: "f99801c211f576100176af502b415eabe393bcaaa95765809b823392b0caa375",
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
