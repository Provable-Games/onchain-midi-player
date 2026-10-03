// @ts-check
// The TinySynth engine used by the tests: the fork's minified build at a pinned commit, vendored in
// tests/vendor (see the README there) so the tests run offline. The hash is checked on every load.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ENGINE_COMMIT = "b70ba90d63c5ea657cb67ca98de90d7f778c29bd";
export const ENGINE_SHA256 = "5aa3edbc13371694a83ec0f285a5d39d4e4a31b18a259c0bbdcbd5969f710c2c";
export const ENGINE_PATH = join(dirname(fileURLToPath(import.meta.url)), "../tests/vendor/webaudio-tinysynth-b70ba90.min.js");

/** The engine's source, after checking its SHA-256. */
export function engineSource() {
  const bytes = readFileSync(ENGINE_PATH);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== ENGINE_SHA256) throw new Error(`${ENGINE_PATH}: sha256 ${hash}, expected ${ENGINE_SHA256}`);
  return bytes.toString("utf8");
}
