// @ts-check
// The pinned TinySynth engine: the Provable-Games fork's own minified build
// (webaudio-tinysynth.min.js) and NOTICE at one commit, vendored in tests/vendor so that the page
// build and the tests run offline. It is the engine embedded in PAGE (scripts/build_page.mjs) and
// the one the engine tests and render checks run. Both files are SHA-256 checked on every load, so
// any mismatch fails before anything is generated.
//
// Re-pinning is a one-line change to ENGINE_PIN, after vendoring the new files with
//   node scripts/vendor_engine.mjs <fork checkout> <commit or tag>
// which prints the new line. `ref` names the vendored files and is recorded with the VERSION in
// scripts/page_versions.json; it is the short commit SHA or, once the fork publishes tagged releases,
// the tag. A re-pin needs a new VERSION (scripts/page.mjs).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE_PIN = { ref: "4bf9829", commit: "4bf982994dc3d1187661385726fed2e6595fafbe", sha256: "8ad79ab8214e45a601e7d929e676b34b78e3f2b4200fd751d6548cf2b7df7749", noticeSha256: "29b1e003f554d943972c538fd2fc173b2515a5320033016a7fdf938a0181b698" };

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
