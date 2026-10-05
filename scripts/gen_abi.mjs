#!/usr/bin/env node
// @ts-check
// Writes the ABIs in abi/ from the release build's Sierra artifacts (target/release/):
//
//   - abi/TinySynth.json: the `abi` array of the class's contract_class.json, the class that
//     is declared and that consumers library-call.
//   - abi/ISoundProvider.json: the interface a composer's contract implements, with the types it
//     uses. The crate declares it but no contract of the crate implements it, so it comes from the
//     test crate's MockSoundProvider (tests/test_provider.cairo), which implements only
//     ISoundProvider: its ABI less the mock's own `impl` and `event` entries.
//
// Both are the compiler's output, pretty-printed (2 spaces) in the compiler's order.
//
// Usage (repository root; the npm scripts build first):
//   npm run gen:abi     scarb --release build (and --test), then write abi/
//   npm run check:abi   the same build, then exit 1 if a file in abi/ is out of date

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TARGET = new URL("../target/release/", import.meta.url);
export const ABI_DIR = new URL("../abi/", import.meta.url);

/** The `abi` array of a Sierra artifact in target/release/. @param {string} name */
function abiOf(name) {
  const url = new URL(name, TARGET);
  let text;
  try {
    text = readFileSync(url, "utf8");
  } catch {
    throw new Error(`${fileURLToPath(url)} not found: run scarb --release build && scarb --release build --test`);
  }
  return JSON.parse(text).abi;
}

/** @returns {Array<[URL, string]>} each file of abi/ and its text */
export function abiFiles() {
  const player = abiOf("onchain_midi_player_TinySynth.contract_class.json");
  const provider = abiOf("onchain_midi_player_tests_MockSoundProvider.test.contract_class.json")
    .filter((/** @type {{type: string}} */ entry) => entry.type !== "impl" && entry.type !== "event");
  if (!provider.some((/** @type {{type: string, name: string}} */ e) => e.type === "interface" && e.name === "onchain_midi_player::interface::ISoundProvider")) {
    throw new Error("MockSoundProvider's ABI has no onchain_midi_player::interface::ISoundProvider");
  }
  const text = (/** @type {unknown} */ abi) => JSON.stringify(abi, null, 2) + "\n";
  return [
    [new URL("TinySynth.json", ABI_DIR), text(player)],
    [new URL("ISoundProvider.json", ABI_DIR), text(provider)],
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let files;
  try {
    files = abiFiles();
  } catch (e) {
    console.error(/** @type {Error} */ (e).message);
    process.exit(1);
  }
  if (process.argv.includes("--check")) {
    const stale = files.filter(([path, text]) => {
      try {
        return readFileSync(path, "utf8") !== text;
      } catch {
        return true;
      }
    });
    for (const [path] of stale) console.error(`out of date: ${fileURLToPath(path)} (run npm run gen:abi)`);
    process.exit(stale.length ? 1 : 0);
  }
  mkdirSync(ABI_DIR, { recursive: true });
  for (const [path, text] of files) writeFileSync(path, text);
  for (const [path] of files) console.log(`wrote ${fileURLToPath(path)}`);
}
