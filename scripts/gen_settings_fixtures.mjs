#!/usr/bin/env node
// @ts-check
// Generates the shared SETTINGS parity fixtures from scripts/settings_fixtures.mjs:
//
//   tests/fixtures/settings.json   every fixture: settings (JSON), expected SETTINGS text or
//                                  expected error, as computed by the JS reference
//                                  (player/encode.js, player/settings.js); for the largest valid
//                                  input (`structuralMax`) and the long-LFSR wave (`longLfsr`),
//                                  only their length and SHA-256
//   tests/settings_fixtures.cairo  the same fixtures as Cairo (Serde felts) plus one snforge
//                                  test per fixture asserting that src/settings.cairo produces
//                                  the same bytes or the same panic data; `structural_max()` and
//                                  `long_lfsr()`, built in loops, with their length and SHA-256
//
// Output is deterministic and already in `scarb fmt` style.
//
// Usage (repository root):
//   node scripts/gen_settings_fixtures.mjs           write both files
//   node scripts/gen_settings_fixtures.mjs --check   exit 1 if either file is out of date

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeSettings } from "../player/encode.js";
import { FILTER_KINDS, OPERATOR_FIELDS, SettingsError, WAVEFORMS, decodeSettings } from "../player/settings.js";
import { validateSettings } from "../player/validate.js";
import { lfsr } from "./reference_waves.mjs";
import { ALL_SLOTS, INVALID, LONG_LFSR_SNARE, VALID, longLfsr, structuralMax, widestOperator } from "./settings_fixtures.mjs";

/** @typedef {import("../player/settings.js").SynthSettings} SynthSettings */
/** @typedef {import("../player/settings.js").Operator} Operator */

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
    // No spread: wave tables have no length bound, and a spread call is bounded by the engine's
    // argument limit.
    const table = "Harmonics" in w ? w.Harmonics : w.Samples;
    f.push("Harmonics" in w ? 0 : 1, table.length);
    for (const x of table) f.push(x);
  }
  f.push(s.timbres.length);
  for (const t of s.timbres) {
    f.push(t.drum ? 1 : 0, t.slot, ...operatorsSerde(t.operators));
  }
  return f.map(String);
}

/**
 * Cairo Serde of a `Span<Operator>`.
 * @param {Operator[]} operators
 * @returns {(number | string)[]}
 */
function operatorsSerde(operators) {
  /** @type {(number | string)[]} */
  const f = [operators.length];
  for (const o of operators) {
    f.push(o.route);
    if (typeof o.wave === "object") f.push(6, o.wave.Custom);
    else f.push(WAVEFORMS.indexOf(o.wave));
    for (const [name] of OPERATOR_FIELDS) f.push(/** @type {any} */ (o)[name]);
    // Option: Some is variant 0, None is variant 1.
    if (o.filter === null) f.push(1);
    else f.push(0, FILTER_KINDS.indexOf(o.filter.kind), o.filter.cutoff, o.filter.key_track ? 1 : 0, o.filter.q);
  }
  return f;
}

/** The 8 operators of every timbre of `structuralMax()`. */
const STRUCTURAL_MAX_OPERATORS = Array.from({ length: 8 }, (_, o) => widestOperator(o));

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
  const invalid = INVALID.map(({ name, settings, error }) => {
    check(JSON.stringify(jsError(settings)) === JSON.stringify(error), `${name}: expected ${error}, got ${jsError(settings)}`);
    return { name, settings, error };
  });
  // The largest valid input, which tests/settings_fixtures.cairo builds in a loop: every slot in the
  // order ALL_SLOTS lists them, with the same 8 operators, on the default settings.
  const max = structuralMax();
  check(jsError(max) === null, `structural_max rejected: ${jsError(max)}`);
  check(JSON.stringify(max.timbres.map((t) => [t.drum, t.slot])) === JSON.stringify(ALL_SLOTS), "structural_max: slots");
  check(max.timbres.every((t) => JSON.stringify(t.operators) === JSON.stringify(STRUCTURAL_MAX_OPERATORS)), "structural_max: operators");
  const maxText = encodeSettings(max);
  check(JSON.stringify(decodeSettings(maxText)) === JSON.stringify(max), "structural_max: decode(encode(x)) != x");
  const structural_max = { bytes: maxText.length, sha256: createHash("sha256").update(maxText).digest("hex") };
  // The long-LFSR wave, which tests/settings_fixtures.cairo builds in a loop: one drum timbre with
  // LONG_LFSR_SNARE, on the default settings.
  const long = longLfsr();
  check(jsError(long) === null, `long_lfsr rejected: ${jsError(long)}`);
  check(JSON.stringify(long.waves) === JSON.stringify([{ Samples: lfsr("long") }]) && lfsr("long").length === 32767, "long_lfsr: wave");
  check(JSON.stringify(long.timbres) === JSON.stringify([{ drum: true, slot: 38, operators: [LONG_LFSR_SNARE] }]), "long_lfsr: timbre");
  const longText = encodeSettings(long);
  check(JSON.stringify(decodeSettings(longText)) === JSON.stringify(long), "long_lfsr: decode(encode(x)) != x");
  const long_lfsr = { bytes: longText.length, sha256: createHash("sha256").update(longText).digest("hex") };
  return { valid, invalid, structural_max, long_lfsr };
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

/**
 * Array items filling lines greedily at `indent` spaces, each followed by a comma, as scarb fmt
 * lays out a long `array![...]`.
 * @param {string[]} items
 * @param {number} indent
 */
function fillItems(items, indent) {
  const pad = " ".repeat(indent);
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
  return lines;
}

/**
 * `let mut felts = array![...]` at indentation 4, on one line if it fits, as scarb fmt lays it out.
 * @param {string[]} items
 */
function feltsArray(items) {
  const inline = `    let mut felts = array![${items.join(", ")}]`;
  return inline.length <= WIDTH ? [inline] : ["    let mut felts = array![", ...fillItems(items, 8), "    ]"];
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
    "use core::sha256::compute_sha256_byte_array;",
    "use onchain_tinysynth::settings::{encode, validate};",
    "use onchain_tinysynth::types::{Operator, SynthSettings, Timbre, WaveDef};",
    "",
    "fn deserialize(felts: Array<felt252>) -> SynthSettings {",
    "    let mut span = felts.span();",
    "    let settings = Serde::deserialize(ref span).expect('fixture: bad Serde');",
    "    assert(span.len() == 0, 'fixture: trailing felts');",
    "    settings",
    "}",
    "",
    "/// SHA-256 of `data` as a big-endian u256, like `sha256sum`.",
    "fn sha256(data: @ByteArray) -> u256 {",
    "    let [a, b, c, d, e, f, g, h] = compute_sha256_byte_array(data);",
    "    let base: u128 = 0x100000000;",
    "    let high = ((a.into() * base + b.into()) * base + c.into()) * base + d.into();",
    "    let low = ((e.into() * base + f.into()) * base + g.into()) * base + h.into();",
    "    u256 { high, low }",
    "}",
    "",
    `/// Length of the largest valid \`SETTINGS\` in v1, \`encode(@structural_max())\`.`,
    `pub const STRUCTURAL_MAX_LEN: u32 = ${fx.structural_max.bytes};`,
    "",
    "/// Its SHA-256, as the JS reference computes it.",
    "pub const STRUCTURAL_MAX_SHA256: u256 =",
    `    0x${fx.structural_max.sha256};`,
    "",
    "/// The largest valid `SynthSettings` in v1 (`structuralMax` in scripts/settings_fixtures.mjs), the",
    "/// most validation and encoding work: every slot (programs 0..=127, then drums 35..=81), each with",
    "/// the same 8 operators with every field at its widest. Built in a loop: too large for a literal.",
    "pub fn structural_max() -> SynthSettings {",
    "    let mut felts = array![",
    ...fillItems(operatorsSerde(STRUCTURAL_MAX_OPERATORS).map(String), 8),
    "    ]",
    "        .span();",
    "    let operators: Span<Operator> = Serde::deserialize(ref felts).expect('fixture: bad Serde');",
    "    let mut timbres: Array<Timbre> = array![];",
    "    for slot in 0..128_u8 {",
    "        timbres.append(Timbre { drum: false, slot, operators });",
    "    }",
    "    for slot in 35..82_u8 {",
    "        timbres.append(Timbre { drum: true, slot, operators });",
    "    }",
    `    SynthSettings {`,
    `        quality: ${structuralMax().quality},`,
    `        reverb: ${structuralMax().reverb},`,
    `        master_vol: ${structuralMax().master_vol},`,
    `        voices: ${structuralMax().voices},`,
    "        waves: [].span(),",
    "        timbres: timbres.span(),",
    "    }",
    "}",
    "",
    "#[test]",
    "fn test_valid_structural_max() {",
    "    let settings = structural_max();",
    "    validate(@settings);",
    "    let text = encode(@settings);",
    "    assert_eq!(text.len(), STRUCTURAL_MAX_LEN);",
    "    assert(sha256(@text) == STRUCTURAL_MAX_SHA256, 'structural_max sha256');",
    "}",
    "",
    "/// Length of `encode(@long_lfsr())`.",
    `pub const LONG_LFSR_LEN: u32 = ${fx.long_lfsr.bytes};`,
    "",
    "/// Its SHA-256, as the JS reference computes it.",
    "pub const LONG_LFSR_SHA256: u256 =",
    `    0x${fx.long_lfsr.sha256};`,
    "",
    "/// One custom wave, a long-mode 15-bit LFSR (`lfsr(\"long\")` in scripts/reference_waves.mjs):",
    "/// from state 1, each step outputs bit 0 (1 is -128, 0 is 127), shifts right and feeds back bit 0",
    "/// XOR bit 1, for 32,767 steps. On a snare (`longLfsr` in scripts/settings_fixtures.mjs). Built in",
    "/// a loop: too large for a literal.",
    "pub fn long_lfsr() -> SynthSettings {",
    "    let mut samples: Array<i8> = array![];",
    "    let mut r: u32 = 1;",
    "    loop {",
    "        samples.append(if r & 1 == 1 {",
    "            -128",
    "        } else {",
    "            127",
    "        });",
    "        r = r / 2 + ((r ^ (r / 2)) & 1) * 0x4000;",
    "        if r == 1 {",
    "            break;",
    "        }",
    "    }",
    ...feltsArray(operatorsSerde([LONG_LFSR_SNARE]).map(String)),
    "        .span();",
    "    let operators: Span<Operator> = Serde::deserialize(ref felts).expect('fixture: bad Serde');",
    "    SynthSettings {",
    `        quality: ${longLfsr().quality},`,
    `        reverb: ${longLfsr().reverb},`,
    `        master_vol: ${longLfsr().master_vol},`,
    `        voices: ${longLfsr().voices},`,
    "        waves: [WaveDef::Samples(samples.span())].span(),",
    "        timbres: [Timbre { drum: true, slot: 38, operators }].span(),",
    "    }",
    "}",
    "",
    "#[test]",
    "fn test_valid_long_lfsr() {",
    "    let settings = long_lfsr();",
    "    validate(@settings);",
    "    let text = encode(@settings);",
    "    assert_eq!(text.len(), LONG_LFSR_LEN);",
    "    assert(sha256(@text) == LONG_LFSR_SHA256, 'long_lfsr sha256');",
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
  console.log(`${fx.valid.length} valid, ${fx.invalid.length} invalid fixtures`);
  for (const f of fx.valid) console.log(`  ${f.name.padEnd(28)} ${String(f.bytes).padStart(6)} bytes`);
  console.log(`  ${"structural_max".padEnd(28)} ${String(fx.structural_max.bytes).padStart(6)} bytes (length and SHA-256 only)`);
  console.log(`  ${"long_lfsr".padEnd(28)} ${String(fx.long_lfsr.bytes).padStart(6)} bytes (length and SHA-256 only)`);
}
