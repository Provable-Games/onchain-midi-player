#!/usr/bin/env node
// @ts-check
// Generates the shared SETTINGS parity fixtures from scripts/settings_fixtures.mjs:
//
//   tests/fixtures/settings.json   every fixture: settings (JSON), expected SETTINGS text or
//                                  expected error, as computed by the JS reference
//                                  (player/encode.js, player/settings.js)
//   tests/settings_fixtures.cairo  the same fixtures as Cairo (Serde felts) plus one snforge
//                                  test per fixture asserting that src/settings.cairo produces
//                                  the same bytes or the same panic data
//
// Output is deterministic and already in `scarb fmt` style.
//
// Usage (repository root):
//   node scripts/gen_settings_fixtures.mjs           write both files
//   node scripts/gen_settings_fixtures.mjs --check   exit 1 if either file is out of date

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeSettings } from "../player/encode.js";
import {
  FILTER_KINDS, OPERATOR_FIELDS, SettingsError, WAVEFORMS, decodeSettings, validateSettings,
} from "../player/settings.js";
import { INVALID, RESERVED, VALID } from "./settings_fixtures.mjs";

/** @typedef {import("../player/settings.js").SynthSettings} SynthSettings */

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const JSON_PATH = join(root, "tests/fixtures/settings.json");
export const CAIRO_PATH = join(root, "tests/settings_fixtures.cairo");

/**
 * Cairo Serde of a `SynthSettings` value, as felt literals.
 * @param {SynthSettings} s
 * @returns {string[]}
 */
export function serde(s) {
  /** @type {(number | string)[]} */
  const f = [s.quality, s.reverb, s.master_vol, s.voices, s.waves.length];
  for (const w of s.waves) {
    if ("Harmonics" in w) f.push(0, w.Harmonics.length, ...w.Harmonics);
    else f.push(1, w.Samples.length, ...w.Samples);
  }
  f.push(s.timbres.length);
  for (const t of s.timbres) {
    f.push(t.drum ? 1 : 0, t.slot, t.operators.length);
    for (const o of t.operators) {
      f.push(o.route);
      if (typeof o.wave === "object") f.push(6, o.wave.Custom);
      else f.push(WAVEFORMS.indexOf(o.wave));
      for (const [name] of OPERATOR_FIELDS) f.push(/** @type {any} */ (o)[name]);
      // Option: Some is variant 0, None is variant 1.
      if (o.filter === null) f.push(1);
      else f.push(0, FILTER_KINDS.indexOf(o.filter.kind), o.filter.cutoff, o.filter.key_track ? 1 : 0, o.filter.q);
    }
  }
  return f.map(String);
}

/**
 * @param {() => unknown} fn
 * @returns {[string, ...number[]] | null}
 */
function caught(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    if (!(e instanceof SettingsError)) throw e;
    return [e.code, ...e.indices];
  }
}

/** The error that Cairo's `validate` then `encode` would raise, per the JS reference. */
const jsError = (/** @type {SynthSettings} */ s) => caught(() => encodeSettings(validateSettings(s)));

/** @param {boolean} cond @param {string} msg */
function check(cond, msg) {
  if (!cond) throw new Error("check failed: " + msg);
}

/** Computes every fixture's expectation with the JS reference and cross-checks it. */
export function buildFixtures() {
  const valid = VALID.map(({ name, settings, expected }) => {
    check(jsError(settings) === null, `${name}: valid fixture rejected: ${jsError(settings)}`);
    const text = encodeSettings(settings);
    if (expected !== undefined) check(text === expected, `${name}: encoder output differs from the pinned text`);
    check(JSON.stringify(decodeSettings(text)) === JSON.stringify(settings), `${name}: decode(encode(x)) != x`);
    return { name, settings, settings_text: text, bytes: text.length };
  });
  const reserved = RESERVED.map(({ name, settings, error }) => {
    const text = encodeSettings(settings);
    check(JSON.stringify(decodeSettings(text)) === JSON.stringify(settings), `${name}: decode(encode(x)) != x`);
    check(JSON.stringify(jsError(settings)) === JSON.stringify(error), `${name}: expected ${error}, got ${jsError(settings)}`);
    return { name, settings, settings_text: text, bytes: text.length, error };
  });
  const invalid = INVALID.map(({ name, settings, error }) => {
    check(JSON.stringify(jsError(settings)) === JSON.stringify(error), `${name}: expected ${error}, got ${jsError(settings)}`);
    return { name, settings, error };
  });
  return { valid, reserved, invalid };
}

// ------------------------------------------------------------------------------------------
// Cairo output, in `scarb fmt` style (line width 100).
// ------------------------------------------------------------------------------------------

const WIDTH = 100;

/**
 * `deserialize(array![...])` as a statement at indentation 4, laid out as scarb fmt does: on one
 * line if it fits, else the array on its own line, else the elements filling lines greedily.
 * @param {string[]} items
 */
function deserializeCall(items) {
  const inline = `    deserialize(array![${items.join(", ")}])`;
  if (inline.length <= WIDTH) return inline;
  const own = `        array![${items.join(", ")}],`;
  if (own.length <= WIDTH) return `    deserialize(\n${own}\n    )`;
  const pad = " ".repeat(12);
  const lines = [];
  let line = "";
  for (const item of items) {
    const next = line ? `${line} ${item},` : `${pad}${item},`;
    if (next.length > WIDTH && line) {
      lines.push(line);
      line = `${pad}${item},`;
    } else line = next;
  }
  lines.push(line);
  return `    deserialize(\n        array![\n${lines.join("\n")}\n        ],\n    )`;
}

/** @param {[string, ...number[]]} error */
function expectedAttr(error) {
  const [msg, ...indices] = error;
  if (indices.length === 0) return `#[should_panic(expected: '${msg}')]`;
  return `#[should_panic(expected: ('${msg}', ${indices.join(", ")}))]`;
}

/**
 * @param {string} fnName
 * @param {string} doc
 * @param {SynthSettings} settings
 */
function settingsFn(fnName, doc, settings) {
  return [
    `/// ${doc}`,
    `pub fn ${fnName}() -> SynthSettings {`,
    deserializeCall(serde(settings)),
    "}",
  ].join("\n");
}

/** @param {string} fnName @param {string} text */
function textFn(fnName, text) {
  return [`pub fn ${fnName}() -> ByteArray {`, `    "${text}"`, "}"].join("\n");
}

/** @param {ReturnType<typeof buildFixtures>} fx */
export function cairoSource(fx) {
  const out = [
    "// Generated by scripts/gen_settings_fixtures.mjs from scripts/settings_fixtures.mjs. DO NOT EDIT.",
    "//",
    "// Shared SETTINGS fixtures as Cairo Serde felts, with the expectations computed by the JS",
    "// reference (player/encode.js, player/settings.js). Each test asserts that src/settings.cairo",
    "// gives the same SETTINGS bytes, or the same panic data, as the JS reference.",
    "",
    "use onchain_tinysynth::settings::{encode, validate};",
    "use onchain_tinysynth::types::SynthSettings;",
    "",
    "fn deserialize(felts: Array<felt252>) -> SynthSettings {",
    "    let mut span = felts.span();",
    "    let settings = Serde::deserialize(ref span).expect('fixture: bad Serde');",
    "    assert(span.len() == 0, 'fixture: trailing felts');",
    "    settings",
    "}",
  ];
  for (const f of fx.valid) {
    out.push("", settingsFn(`valid_${f.name}`, `Valid: ${f.bytes} bytes of SETTINGS.`, f.settings));
    out.push("", textFn(`valid_${f.name}_text`, f.settings_text));
    out.push(
      "",
      "#[test]",
      `fn test_valid_${f.name}() {`,
      `    let settings = valid_${f.name}();`,
      "    validate(@settings);",
      `    assert_eq!(encode(@settings), valid_${f.name}_text());`,
      "}",
    );
  }
  for (const f of fx.reserved) {
    out.push("", settingsFn(`reserved_${f.name}`, `Encodable, rejected in v1: ${f.bytes} bytes of SETTINGS.`, f.settings));
    out.push("", textFn(`reserved_${f.name}_text`, f.settings_text));
    out.push(
      "",
      "#[test]",
      `fn test_reserved_${f.name}_encoding() {`,
      `    let settings = reserved_${f.name}();`,
      `    assert_eq!(encode(@settings), reserved_${f.name}_text());`,
      "}",
      "",
      "#[test]",
      expectedAttr(f.error),
      `fn test_reserved_${f.name}_rejected_in_v1() {`,
      `    validate(@reserved_${f.name}());`,
      "}",
    );
  }
  for (const f of fx.invalid) {
    out.push("", settingsFn(`invalid_${f.name}`, `Invalid: ${f.error[0]}.`, f.settings));
    out.push(
      "",
      "#[test]",
      expectedAttr(f.error),
      `fn test_invalid_${f.name}() {`,
      `    let settings = invalid_${f.name}();`,
      "    validate(@settings);",
      "    let _text = encode(@settings);",
      "}",
    );
  }
  return out.join("\n") + "\n";
}

/** @param {ReturnType<typeof buildFixtures>} fx */
export function jsonSource(fx) {
  return JSON.stringify(
    {
      _comment: "Generated by scripts/gen_settings_fixtures.mjs from scripts/settings_fixtures.mjs. DO NOT EDIT.",
      ...fx,
    },
    null,
    1,
  ) + "\n";
}

/** The generated files' expected contents. */
export function generate() {
  const fx = buildFixtures();
  return { json: jsonSource(fx), cairo: cairoSource(fx), fx };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { json, cairo, fx } = generate();
  const files = [[JSON_PATH, json], [CAIRO_PATH, cairo]];
  if (process.argv.includes("--check")) {
    const stale = files.filter(([path, text]) => {
      try {
        return readFileSync(path, "utf8") !== text;
      } catch {
        return true;
      }
    });
    for (const [path] of stale) console.error(`out of date: ${path} (run node scripts/gen_settings_fixtures.mjs)`);
    process.exit(stale.length ? 1 : 0);
  }
  for (const [path, text] of files) writeFileSync(path, text);
  console.log(`${fx.valid.length} valid, ${fx.reserved.length} reserved, ${fx.invalid.length} invalid fixtures`);
  for (const f of [...fx.valid, ...fx.reserved]) console.log(`  ${f.name.padEnd(28)} ${String(f.bytes).padStart(5)} bytes`);
}
