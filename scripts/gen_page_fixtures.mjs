// @ts-check
// Golden fixtures for the class's page outputs, computed by the JS reference (scripts/page.mjs)
// from the inputs in scripts/page_fixtures.mjs. scripts/build_page.mjs calls `pageFixtures` and
// writes the results:
//
//   tests/fixtures/page.json      per valid case: the inputs (settings in the shape of
//                                 tests/fixtures/settings.json, MIDI as base64, SVG, JSON members)
//                                 and the expected outputs: SETTINGS, D, its pad, midi_segment in
//                                 full, and the decoded animation_url HTML (PAGE ++ D ++ SVG) and the
//                                 Beasts-layout token_uri as length + SHA-256; per invalid case the
//                                 settings and the expected panic data
//   tests/page_fixtures.cairo     the same as Cairo (inputs, expected midi_segment, digests), with
//                                 the tests: page_data against the build; per valid case, SETTINGS,
//                                 midi_segment (direct and by library call), the decoded HTML and
//                                 the token_uri against the digests; per invalid case, the revert
//                                 and its exact panic data (direct and by library call)
//
// The large outputs are pinned by length and SHA-256 rather than stored: each is ~50-110 KB, and
// both are fully determined by stored pieces (tests/fixtures/page.html, D, the SVG and the members).
// The beast_consumer example holds three complete token_uri goldens.

import { isDeepStrictEqual } from "node:util";
import { SettingsError } from "../player/settings.js";
import { checkMidi } from "../player/player.js";
import { serde } from "./gen_settings_fixtures.mjs";
import {
  ART_OPEN, MIDI_OPEN, URL_KEY, b64, blen, byteArrayFelts, constFeltArray, consumerPieces, decodeTokenUri, dFragment,
  midiSegment, naiveTokenUri, segmentFor, sha256, spliceTokenUri,
} from "./page.mjs";
import { CASES, INVALID_CASES, INVALID_MIDI } from "./page_fixtures.mjs";

/** @param {boolean} cond @param {string} msg */
function check(cond, msg) {
  if (!cond) throw new Error("check failed: " + msg);
}

/**
 * A case's MIDI, with its text meta event lengthened until D gets the case's pad.
 * @param {typeof CASES[number]} c
 */
function tunedMidi(c) {
  for (let extra = 0; extra < 27; extra++) {
    const midi = c.midi(`fixture ${c.name}${".".repeat(extra)}`);
    if (dFragment(midi, c.settings).pad === c.dPad) return midi;
  }
  throw new Error(`${c.name}: no MIDI length gives D pad ${c.dPad}`);
}

/**
 * Every fixture, computed and cross-checked.
 * @param {string} page PAGE
 * @param {{version: string, license: string, engineCommit: string, engineSha256: string, gzipSha256: string, gzipLen: number, shimSha256: string}} meta
 */
export function pageFixtures(page, meta) {
  const segment = segmentFor(page);
  const valid = CASES.map((c) => {
    const midi = tunedMidi(c);
    const { maxTick, seconds } = checkMidi(midi);
    const { d, pad } = dFragment(midi, c.settings);
    const parts = { mem: c.members, svg: c.svg, pageHtml: page, d };
    const uri = spliceTokenUri(parts);
    const html = page + d + c.svg;
    // Splicing equals one-pass nesting, and the token_uri decodes to exactly the expected layers.
    check(uri === naiveTokenUri(parts), `${c.name}: spliced != naive`);
    const dec = decodeTokenUri(uri);
    check(dec.html === html && dec.svg === c.svg, `${c.name}: decoded layers`);
    check(isDeepStrictEqual(Object.keys(dec.json), [...Object.keys(JSON.parse(`{${c.members}}`)), "image", "animation_url"]), `${c.name}: keys`);
    check(dec.json.animation_url === "data:text/html;base64," + b64(html), `${c.name}: animation_url`);
    check(blen(d) % 9 === 0 && d.endsWith(ART_OPEN) && d.includes(MIDI_OPEN + b64(midi) + " ".repeat(pad) + ART_OPEN), `${c.name}: D`);
    const p = consumerPieces(c.members, c.svg);
    return {
      name: c.name,
      settings: c.settings,
      settings_text: d.slice(0, d.indexOf(MIDI_OPEN)),
      midi_b64: b64(midi),
      midi_max_tick: maxTick,
      midi_loop_seconds: seconds,
      svg: c.svg,
      members: c.members,
      d_pad: pad,
      head_pad: p.headPad,
      s_pad: p.sPad,
      d,
      midi_segment: midiSegment(midi, c.settings),
      animation_html: { len: blen(html), sha256: sha256(html) },
      token_uri: { len: uri.length, sha256: sha256(uri) },
    };
  });
  // Every padding length occurs: D pads 0..8, consumer pads 0..2.
  check(new Set(valid.map((v) => v.d_pad)).size === 9, "cases must cover every D pad 0..8");
  check(new Set(valid.map((v) => v.head_pad)).size === 3 && new Set(valid.map((v) => v.s_pad)).size === 3, "cases must cover every consumer pad 0..2");
  const invalid = INVALID_CASES.map(({ name, settings, error }) => {
    let got = null;
    try {
      dFragment(INVALID_MIDI, settings);
    } catch (e) {
      if (!(e instanceof SettingsError)) throw e;
      got = [e.code, ...e.indices];
    }
    check(isDeepStrictEqual(got, error), `${name}: expected ${error}, got ${got}`);
    return { name, settings, midi_b64: b64(INVALID_MIDI), error };
  });
  const json = {
    _comment: "Generated by scripts/build_page.mjs (scripts/gen_page_fixtures.mjs). DO NOT EDIT.",
    page: {
      version: meta.version,
      engine_commit: meta.engineCommit,
      engine_sha256: meta.engineSha256,
      gzip_len: meta.gzipLen,
      gzip_sha256: meta.gzipSha256,
      shim_sha256: meta.shimSha256,
      page_len: page.length,
      page_sha256: sha256(page),
      page_pad: page.length - page.trimEnd().length,
      segment_prefix: URL_KEY,
      segment_len: segment.length,
      segment_sha256: sha256(segment),
      license_len: blen(meta.license),
      license_sha256: sha256(meta.license),
    },
    valid,
    invalid,
  };
  return { json: JSON.stringify(json, null, 1) + "\n", cairo: cairoSource(json, valid.map((v, i) => ({ ...v, midi: Buffer.from(v.midi_b64, "base64"), i }))) };
}

// ---------------------------------------------------------------------------------------------
// Cairo output, formatter-stable (scarb fmt, line width 100)
// ---------------------------------------------------------------------------------------------

/**
 * A `const` felt array and a function deserializing it.
 * @param {string} fnName
 * @param {string} type
 * @param {string[]} felts
 */
function deserializeFn(fnName, type, felts) {
  const constName = fnName.toUpperCase();
  return [
    `pub fn ${fnName}() -> ${type} {`,
    `    let mut felts = ${constName}.span();`,
    `    let value = Serde::deserialize(ref felts).expect('fixture: bad Serde');`,
    "    assert(felts.len() == 0, 'fixture: trailing felts');",
    "    value",
    "}",
    "",
    constFeltArray(constName, felts),
  ].join("\n");
}

/** A u256 literal from hex. */
const u256 = (/** @type {string} */ hex) => "0x" + hex;

/**
 * @param {any} json
 * @param {Array<any>} cases
 */
function cairoSource(json, cases) {
  const pg = json.page;
  const out = [
    "// Generated by scripts/build_page.mjs (scripts/gen_page_fixtures.mjs). DO NOT EDIT.",
    "//",
    "// Golden fixtures for the page outputs, computed by the JS reference (scripts/page.mjs); the same",
    "// data as tests/fixtures/page.json. Per valid case: the inputs (`case_<name>_midi`, `_settings`,",
    "// `_svg`, `_members`), the expected `midi_segment(midi, settings)` in full, and the expected",
    "// decoded animation_url HTML and Beasts-layout token_uri as length and SHA-256. Per invalid case:",
    "// the settings and the panic data midi_segment must revert with. The tests: the generated",
    "// page_data constants against the build; per valid case, SETTINGS, midi_segment (called directly",
    "// and through the library dispatcher on the declared class), and the decoded HTML",
    "// (PAGE ++ D ++ SVG) and the token_uri, rebuilt in Cairo, against the digests; per invalid case,",
    "// the revert, directly and through the library dispatcher, with its exact panic data.",
    "",
    "use core::sha256::compute_sha256_byte_array;",
    "use onchain_midi_player::interface::{",
    "    IOnchainTinySynthDispatcherTrait, IOnchainTinySynthSafeDispatcherTrait,",
    "};",
    "use onchain_midi_player::settings::{encode, validate};",
    "use onchain_midi_player::types::TinySynthSettings;",
    "use onchain_midi_player::{page_data, segment};",
    "use crate::class_fixtures;",
    "use crate::helpers::{beasts_token_uri, class, safe_class};",
    "",
    "/// SHA-256 of `data` as a big-endian u256, like `sha256sum`.",
    "pub fn sha256(data: @ByteArray) -> u256 {",
    "    let [a, b, c, d, e, f, g, h] = compute_sha256_byte_array(data);",
    "    u256 { high: be128(a, b, c, d), low: be128(e, f, g, h) }",
    "}",
    "",
    "fn be128(x: u32, y: u32, z: u32, w: u32) -> u128 {",
    "    let base: u128 = 0x100000000;",
    "    ((x.into() * base + y.into()) * base + z.into()) * base + w.into()",
    "}",
    "",
    `/// SHA-256 of PAGE (tests/fixtures/page.html), ${pg.page_len} bytes.`,
    `pub const PAGE_SHA256: u256 = ${u256(pg.page_sha256)};`,
    "",
    `/// SHA-256 of \`animation_url_segment()\`, ${pg.segment_len} bytes.`,
    `pub const SEGMENT_SHA256: u256 = ${u256(pg.segment_sha256)};`,
    "",
    `/// SHA-256 of \`license()\`, ${pg.license_len} bytes.`,
    `pub const LICENSE_SHA256: u256 = ${u256(pg.license_sha256)};`,
    `pub const LICENSE_LEN: u32 = ${pg.license_len};`,
    "",
    `/// SHA-256 of the engine (the pinned fork build, commit ${pg.engine_commit.slice(0, 7)}).`,
    `pub const ENGINE_SHA256: u256 = ${u256(pg.engine_sha256)};`,
    "",
    `/// SHA-256 of the engine's gzip payload in PAGE, ${pg.gzip_len} bytes.`,
    `pub const GZIP_SHA256: u256 = ${u256(pg.gzip_sha256)};`,
    `pub const GZIP_LEN: u32 = ${pg.gzip_len};`,
    "",
    "#[test]",
    "fn page_data_segment_matches_the_build() {",
    "    let segment = page_data::animation_url_segment();",
    "    assert_eq!(segment.len(), page_data::SEGMENT_LEN);",
    "    assert_eq!(page_data::SEGMENT_LEN, 4 * (39 + 4 * page_data::PAGE_LEN / 3) / 3);",
    "    assert_eq!(page_data::PAGE_LEN % 9, 0);",
    "    assert(sha256(@segment) == SEGMENT_SHA256, 'segment sha256');",
    "    // b64('\"animation_url\":\"data:text/html;base64,')",
    "    let prefix: ByteArray = \"ImFuaW1hdGlvbl91cmwiOiJkYXRhOnRleHQvaHRtbDtiYXNlNjQs\";",
    "    let mut i = 0;",
    "    while i != prefix.len() {",
    "        assert(segment[i] == prefix[i], 'segment prefix');",
    "        i += 1;",
    "    }",
    "}",
    "",
    "#[test]",
    "fn page_data_license_version_and_engine_hashes_match_the_build() {",
    "    let license = page_data::license();",
    "    assert_eq!(license.len(), LICENSE_LEN);",
    "    assert(sha256(@license) == LICENSE_SHA256, 'license sha256');",
    `    assert(page_data::VERSION == '${pg.version}', 'version');`,
    "    assert(page_data::ENGINE_SHA256 == ENGINE_SHA256, 'engine sha256');",
    "    assert(page_data::GZIP_SHA256 == GZIP_SHA256, 'gzip sha256');",
    "    assert_eq!(page_data::GZIP_LEN, GZIP_LEN);",
    "}",
  ];
  for (const c of cases) {
    const n = `case_${c.name}`;
    out.push(
      "",
      `// ${c.name}: D pad ${c.d_pad}, head pad ${c.head_pad}, S pad ${c.s_pad}; ${c.midi.length} bytes of MIDI, ` +
        `${c.settings_text.length} of SETTINGS.`,
      "",
      deserializeFn(`${n}_midi`, "ByteArray", byteArrayFelts(c.midi)),
      "",
      deserializeFn(`${n}_settings`, "TinySynthSettings", serde(c.settings)),
      "",
      deserializeFn(`${n}_svg`, "ByteArray", byteArrayFelts(c.svg)),
      "",
      deserializeFn(`${n}_members`, "ByteArray", byteArrayFelts(c.members)),
      "",
      `/// Expected midi_segment(midi, settings) for this case: b64(b64(D)), ${c.midi_segment.length} bytes.`,
      deserializeFn(`${n}_midi_segment`, "ByteArray", byteArrayFelts(c.midi_segment)),
      "",
      `/// The decoded animation_url HTML, PAGE ++ D ++ SVG, as (length, SHA-256): ${c.animation_html.len} bytes.`,
      `pub fn ${n}_animation_html_digest() -> (u32, u256) {`,
      `    (${c.animation_html.len}, ${u256(c.animation_html.sha256)})`,
      "}",
      "",
      `/// The Beasts-layout token_uri for this case's members and SVG, as (length, SHA-256).`,
      `pub fn ${n}_token_uri_digest() -> (u32, u256) {`,
      `    (${c.token_uri.len}, ${u256(c.token_uri.sha256)})`,
      "}",
      "",
      "/// SETTINGS for this case's settings.",
      `pub fn ${n}_settings_text() -> ByteArray {`,
      `    "${c.settings_text}"`,
      "}",
      "",
      "#[test]",
      `fn ${n}_settings_encode_as_in_the_fixture() {`,
      `    let settings = ${n}_settings();`,
      "    validate(@settings);",
      `    assert_eq!(encode(@settings), ${n}_settings_text());`,
      "}",
      "",
      "#[test]",
      `fn ${n}_midi_segment_matches_the_fixture() {`,
      `    let settings = ${n}_settings();`,
      `    let got = segment::midi_segment(${n}_midi(), @settings);`,
      `    assert(got == ${n}_midi_segment(), 'midi_segment != fixture');`,
      "}",
      "",
      "#[test]",
      `fn ${n}_library_call_matches_the_fixture() {`,
      `    let settings = ${n}_settings();`,
      `    let got = class().midi_segment(${n}_midi(), settings);`,
      `    assert(got == ${n}_midi_segment(), 'midi_segment != fixture');`,
      "}",
      "",
      "#[test]",
      `fn ${n}_html_and_token_uri_match_the_digests() {`,
      `    let midi = ${n}_midi();`,
      `    let settings = ${n}_settings();`,
      `    let svg = ${n}_svg();`,
      "    let mut html = class_fixtures::page();",
      "    html.append(@segment::d_fragment(midi.clone(), @settings));",
      "    html.append(@svg);",
      "    let html_digest = (html.len(), sha256(@html));",
      `    assert(html_digest == ${n}_animation_html_digest(), 'html != digest');`,
      `    let uri = beasts_token_uri(@${n}_members(), @svg, midi, @settings);`,
      "    let uri_digest = (uri.len(), sha256(@uri));",
      `    assert(uri_digest == ${n}_token_uri_digest(), 'token_uri != digest');`,
      "}",
    );
  }
  const invalidMidis = new Set(json.invalid.map((/** @type {any} */ c) => c.midi_b64));
  if (invalidMidis.size !== 1) throw new Error("invalid cases must share one MIDI");
  out.push(
    "",
    "/// The MIDI of the invalid cases (midi_segment reverts before it is used).",
    deserializeFn("invalid_midi", "ByteArray", byteArrayFelts(Buffer.from(json.invalid[0].midi_b64, "base64"))),
  );
  for (const c of json.invalid) {
    const n = `invalid_${c.name}`;
    const [msg, ...indices] = c.error;
    const shouldPanic = indices.length ? `#[should_panic(expected: ('${msg}', ${indices.join(", ")}))]` : `#[should_panic(expected: '${msg}')]`;
    out.push(
      "",
      `/// midi_segment must revert with ${JSON.stringify(c.error).replace(/"/g, "'")}.`,
      deserializeFn(`${n}_settings`, "TinySynthSettings", serde(c.settings)),
      "",
      "",
      `/// The panic data midi_segment must revert with.`,
      `pub fn ${n}_error() -> Array<felt252> {`,
      `    array![${["'" + msg + "'", ...indices].join(", ")}]`,
      "}",
      "",
      "#[test]",
      shouldPanic,
      `fn ${n}_settings_revert() {`,
      `    let settings = ${n}_settings();`,
      "    validate(@settings);",
      "    let _text = encode(@settings);",
      "}",
      "",
      "#[test]",
      shouldPanic,
      `fn ${n}_midi_segment_reverts() {`,
      `    let _segment = segment::midi_segment(invalid_midi(), @${n}_settings());`,
      "}",
      "",
      "// Through the library call, the panic data arrives whole, followed by 'ENTRYPOINT_FAILED'.",
      "#[test]",
      '#[feature("safe_dispatcher")]',
      `fn ${n}_library_call_reverts_with_the_panic_data() {`,
      `    match safe_class().midi_segment(invalid_midi(), ${n}_settings()) {`,
      "        Result::Ok(_) => panic!(\"midi_segment should revert\"),",
      "        Result::Err(panic_data) => {",
      `            let mut expected = ${n}_error();`,
      "            expected.append('ENTRYPOINT_FAILED');",
      "            assert_eq!(panic_data, expected);",
      "        },",
      "    }",
      "}",
    );
  }
  const src = out.join("\n") + "\n";
  // scarb fmt rewraps longer lines; only string literals (which it leaves alone) may exceed 100.
  const long = src.split("\n").find((line) => line.length > 100 && !/^ {4}"[0-9,-]*"$/.test(line));
  if (long) throw new Error(`generated Cairo line longer than 100 characters: ${long.slice(0, 120)}`);
  return src;
}
