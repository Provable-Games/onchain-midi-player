#!/usr/bin/env node
// Versioned consumer certification CLI. Exit codes: 0 complete pass, 1 observed failure, 2 incomplete.

import { readFileSync } from "node:fs";
import { GOOD_MIDI, BEND_RANGE_MIDI, SIMPLE_SETTINGS } from "./fixtures.mjs";
import { expectedReleasePins, PRODUCTION_MANIFEST_PATH, PRODUCTION_RESULTS_PATH } from "./release.mjs";
import { validateProductionDocuments } from "./production.mjs";
import { certifyFixtureRuntime, certifyProductionPairRuntimes } from "./runtime.mjs";
import { fileURLToPath } from "node:url";

/** @param {string[]} argv @returns {Record<string, string>} */
function args(argv) {
  const out = /** @type {Record<string, string>} */ ({});
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (!value.startsWith("--")) throw new Error(`unexpected argument: ${value}`);
    const key = value.slice(2);
    if (["scope", "case", "manifest", "results"].includes(key)) {
      const next = argv[++i];
      if (!next || next.startsWith("--")) throw new Error(`--${key} needs a value`);
      out[key] = next;
    } else throw new Error(`unknown option: ${value}`);
  }
  return out;
}

/** @param {string | URL} path @returns {string | null} */
function text(path) {
  try { return readFileSync(path, "utf8"); }
  catch { return null; }
}

/** @param {string} status */
function exitStatus(status) {
  return status === "pass" ? 0 : status === "fail" ? 1 : 2;
}

async function main() {
  /** @type {Record<string, string>} */
  let options;
  try { options = args(process.argv.slice(2)); }
  catch (error) {
    console.error(String(/** @type {Error} */ (error).message || error));
    return 2;
  }
  if (options.scope === "fixture") {
    const fixture = options.case || "good";
    const cases = /** @type {Record<string, Uint8Array>} */ ({
      good: GOOD_MIDI,
      "bend-known-bad": BEND_RANGE_MIDI,
    });
    if (!(fixture in cases)) {
      console.error(`unknown fixture case: ${fixture}; choose good or bend-known-bad`);
      return 2;
    }
    const result = await certifyFixtureRuntime(cases[fixture], SIMPLE_SETTINGS);
    const output = { ...result, case: fixture };
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
    return exitStatus(result.status);
  }
  if (options.scope !== "production") {
    console.error("usage: node scripts/certification/cli.mjs --scope fixture [--case good|bend-known-bad] | --scope production [--manifest PATH] [--results PATH]");
    return 2;
  }
  const manifestPath = options.manifest || fileURLToPath(PRODUCTION_MANIFEST_PATH);
  const resultsPath = options.results || fileURLToPath(PRODUCTION_RESULTS_PATH);
  const runtimeProbe = await certifyFixtureRuntime(GOOD_MIDI, SIMPLE_SETTINGS);
  if (runtimeProbe.status !== "pass") {
    const status = runtimeProbe.status === "fail" ? "fail" : "incomplete";
    const result = { status, failures: runtimeProbe.problems || [], incomplete: runtimeProbe.incomplete || [], runtimeProbe: runtimeProbe.runtime };
    process.stdout.write(JSON.stringify({ ...result, scope: "production", manifestPath, resultsPath, nativeEvidenceRequired: true, nativeAudioRenderedHere: false }, null, 2) + "\n");
    return exitStatus(status);
  }
  const manifestText = text(manifestPath);
  const pairRuntimeResults = await certifyProductionPairRuntimes(manifestText || "");
  const result = validateProductionDocuments({
    manifestText,
    resultsText: text(resultsPath),
    expected: { ...expectedReleasePins(), runtimeObservation: runtimeProbe.runtime },
    pairRuntimeResults,
  });
  process.stdout.write(JSON.stringify({ ...result, manifestPath, resultsPath, nativeEvidenceRequired: true, nativeAudioRenderedHere: false }, null, 2) + "\n");
  return exitStatus(result.status);
}

process.exitCode = await main();
