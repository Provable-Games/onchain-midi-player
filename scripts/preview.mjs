#!/usr/bin/env node
// @ts-check
// Writes the animation_url page a token would get, offline, so a composer or sound designer can hear
// a score with its settings and art before anything goes onchain (README: "Previewing a score"). Node
// built-ins only, but it imports the player and the page build: run it from a checkout of this
// repository. It needs no `npm install`.
//
// Usage: node scripts/preview.mjs <midi> [--settings <file.json | SETTINGS file>] [--svg <file.svg>]
//                                [--out <file.html>] [--serve [port]]
//
//   <midi>      one score, in any form scripts/check_midi.mjs reads: a .mid file, a base64 file or
//               string, a JSON file with one "midi_b64" string, or "-" for standard input
//   --settings  a TinySynthSettings value as JSON, in the shape of player/settings.js and the "settings"
//               objects of tests/fixtures/settings.json (a whole fixture entry also works), or the
//               SETTINGS text of a page (to rebuild a token's page from its blocks). Default: the
//               class's default settings, as default_settings() in src/settings.cairo
//   --svg       the token's SVG art. Default: a small neutral placeholder
//   --out       where to write the page. Default: preview.html
//   --serve     also serve the page on http://127.0.0.1:<port>/ (default 8000; 0 picks a free port)
//
// Before writing anything it runs the checks the class and the page run on the same inputs:
//   - the MIDI with the page's own checkMidi, reported exactly as check_midi.mjs reports it;
//   - the settings with player/validate.js and player/encode.js, the JS reference of the class's
//     settings::validate and encode (same checks, order, messages and indices; the parity fixtures
//     are tests/fixtures/settings.json), so an error here is the revert midi_segment would give;
//   - the art rule: the SVG must never contain `</script`, in any letter case.
// It then writes PAGE ++ D ++ SVG, the decoded animation_url of a token with these inputs, byte for
// byte as the class and a consumer produce it (scripts/page.mjs: pageHtml, dFragment).
// The page is this checkout's PAGE: check out the commit whose VERSION equals the class's version().
//
// Exit status: 0 when the page is written, 1 when the MIDI, the settings or the SVG fails its check,
// 2 on a usage error or an input that cannot be read.

import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeSettings } from "../player/encode.js";
import { decodeMidi } from "../player/player.js";
import { OPERATOR_FIELDS, SettingsError, decodeSettings } from "../player/settings.js";
import { InputError, checkScore, formatResult, scoresFromArg } from "./check_midi.mjs";
import { VERSION, dFragment, pageHtml } from "./page.mjs";
import { DEFAULT_SETTINGS } from "./settings_fixtures.mjs";

/** @typedef {import("../player/settings.js").TinySynthSettings} TinySynthSettings */

const USAGE =
  "usage: node scripts/preview.mjs <file.mid | base64 file | file.json | - | base64 string> " +
  "[--settings <file.json | SETTINGS file>] [--svg <file.svg>] [--out <file.html>] [--serve [port]]";
export const DEFAULT_OUT = "preview.html";
export const DEFAULT_PORT = 8000;

/** The art when no --svg is given: neutral, static, and safe for the art block. */
export const PLACEHOLDER_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='350' height='350' viewBox='0 0 350 350'>" +
  "<rect width='350' height='350' fill='#1e1e22'/>" +
  "<text x='175' y='180' text-anchor='middle' fill='#8a8a96' font-family='monospace' font-size='18'>preview</text>" +
  "</svg>";

/** A check that failed: the report lines, and exit status 1 (a check) or 2 (unreadable input). */
export class PreviewError extends Error {
  /**
   * @param {string[]} lines
   * @param {1 | 2} status
   */
  constructor(lines, status) {
    super(lines.join("\n"));
    this.lines = lines;
    this.status = status;
  }
}

const SETTINGS_KEYS = ["quality", "reverb", "master_vol", "voices", "waves", "timbres"];
const TIMBRE_KEYS = ["drum", "slot", "operators"];
const OPERATOR_KEYS = ["route", "wave", ...OPERATOR_FIELDS.map(([name]) => name), "filter"];
const FILTER_KEYS = ["kind", "cutoff", "key_track", "q"];

/**
 * Throws unless `value` is a plain object with exactly `keys`: a missing field would reach the
 * validator as `undefined`, and a misspelt one would be ignored silently.
 * @param {unknown} value
 * @param {string[]} keys
 * @param {string} at
 * @returns {Record<string, unknown>}
 */
function exactKeys(value, keys, at) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${at} must be an object`);
  const o = /** @type {Record<string, unknown>} */ (value);
  const missing = keys.filter((k) => !(k in o));
  if (missing.length) throw new TypeError(`${at} is missing ${missing.join(", ")}`);
  const unknown = Object.keys(o).filter((k) => !keys.includes(k));
  if (unknown.length) throw new TypeError(`${at} has unknown field${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}`);
  return o;
}

/**
 * @param {unknown} value
 * @param {string} at
 * @returns {unknown[]}
 */
function array(value, at) {
  if (!Array.isArray(value)) throw new TypeError(`${at} must be an array`);
  return value;
}

/**
 * Checks that a parsed JSON value has the shape and the Cairo types of `TinySynthSettings` (what Cairo's
 * Serde would require before `validate` runs), and returns it. Throws a TypeError naming the field.
 * @param {unknown} value
 * @returns {TinySynthSettings}
 */
export function settingsShape(value) {
  const s = exactKeys(value, SETTINGS_KEYS, "settings");
  array(s.waves, "settings.waves").forEach((w, i) => {
    const at = `settings.waves[${i}]`;
    const o = w && typeof w === "object" && !Array.isArray(w) ? /** @type {Record<string, unknown>} */ (w) : {};
    const key = "Harmonics" in o ? "Harmonics" : "Samples" in o ? "Samples" : null;
    if (!key) throw new TypeError(`${at} must be {"Harmonics": [...]} or {"Samples": [...]}`);
    array(exactKeys(w, [key], at)[key], `${at}.${key}`);
  });
  array(s.timbres, "settings.timbres").forEach((t, ti) => {
    const timbre = exactKeys(t, TIMBRE_KEYS, `settings.timbres[${ti}]`);
    array(timbre.operators, `settings.timbres[${ti}].operators`).forEach((op, oi) => {
      const at = `settings.timbres[${ti}].operators[${oi}]`;
      const o = exactKeys(op, OPERATOR_KEYS, at);
      if (o.wave && typeof o.wave === "object") exactKeys(o.wave, ["Custom"], `${at}.wave`);
      if (o.filter !== null) exactKeys(o.filter, FILTER_KEYS, `${at}.filter`);
    });
  });
  // The scalar types (u8, u32, i32, bool, the enum names), with the encoder's own messages. A
  // SettingsError here is a check of the class (such as a length limit), reported by buildPreview.
  try {
    encodeSettings(/** @type {TinySynthSettings} */ (value));
  } catch (e) {
    if (!(e instanceof SettingsError)) throw e;
  }
  return /** @type {TinySynthSettings} */ (value);
}

/**
 * The settings in a file's text: a `TinySynthSettings` object as JSON, a fixture entry holding one under
 * "settings" (as in tests/fixtures/settings.json), or SETTINGS text as a page carries it (digits,
 * `-` and `,`), parsed strictly by the page's own decodeSettings.
 * @param {string} label
 * @param {string} text
 * @returns {TinySynthSettings}
 */
export function settingsFromText(label, text) {
  if (/^ *-?[0-9]+(,-?[0-9]+)+ *$/.test(text.trim())) {
    try {
      return settingsShape(decodeSettings(text.trim()));
    } catch (e) {
      throw new PreviewError([`FAIL ${label}`, `  ${/** @type {Error} */ (e).message}`], 1);
    }
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new PreviewError([`ERROR ${label}: not valid JSON (${/** @type {Error} */ (e).message})`], 2);
  }
  if (doc && typeof doc === "object" && !("quality" in doc) && "settings" in doc) doc = doc.settings;
  try {
    return settingsShape(doc);
  } catch (e) {
    throw new PreviewError([`FAIL ${label}`, `  ${/** @type {Error} */ (e).message}`], 1);
  }
}

/**
 * The panic data midi_segment reverts with for a SettingsError, as Cairo prints it.
 * @param {SettingsError} e
 */
export const panicData = (e) => `('${e.code}'${e.indices.map((i) => `, ${i}`).join("")})`;

/**
 * Builds the page for one score, settings and SVG, after the checks the class and the page run on
 * them. Returns the page and the report; throws a PreviewError with the report of the first failure.
 * @param {{midiArg: string, settings?: TinySynthSettings, settingsLabel?: string, svg?: Uint8Array, svgLabel?: string}} input
 * @returns {{html: Buffer, lines: string[]}}
 */
export function buildPreview({ midiArg, settings = DEFAULT_SETTINGS, settingsLabel = "default settings", svg, svgLabel = "placeholder SVG" }) {
  // 1. The MIDI, as check_midi.mjs checks and reports it.
  let scores;
  try {
    scores = scoresFromArg(midiArg);
  } catch (e) {
    if (!(e instanceof InputError) && !(e && /** @type {any} */ (e).code)) throw e;
    throw new PreviewError([`ERROR ${/** @type {Error} */ (e).message}`], 2);
  }
  if (scores.length !== 1) throw new PreviewError([`ERROR ${midiArg}: ${scores.length} scores; give exactly one`], 2);
  const [score] = scores;
  const result = checkScore(score);
  const lines = formatResult(result);
  if (!result.ok) throw new PreviewError(lines, 1);
  const midi = score.bytes ?? decodeMidi(/** @type {string} */ (score.b64));

  // 2. The settings, as midi_segment validates and encodes them (D carries SETTINGS).
  let d;
  try {
    ({ d } = dFragment(midi, settings));
  } catch (e) {
    if (!(e instanceof SettingsError)) throw e;
    throw new PreviewError([...lines, `FAIL ${settingsLabel}`, `  ${e.message}`, `  midi_segment would revert with ${panicData(e)}`], 1);
  }
  const settingsText = d.slice(0, d.indexOf("<"));
  lines.push(`PASS ${settingsLabel}`, `  SETTINGS: ${settingsText.length} bytes`);

  // 3. The art rule: the page's art block ends at the first `</script`.
  const art = svg ?? Buffer.from(PLACEHOLDER_SVG, "utf8");
  const text = Buffer.from(art).toString("latin1");
  const at = text.search(/<\/script/i);
  if (at >= 0) {
    throw new PreviewError([
      ...lines,
      `FAIL ${svgLabel}`,
      `  art: the SVG contains ${JSON.stringify(text.slice(at, at + 8))} at byte ${at}; the page's art block would end there`,
      "  (README: \"Art (SVG) requirements\")",
    ], 1);
  }
  lines.push(`PASS ${svgLabel}`, `  ${art.length} bytes, no </script`);

  // PAGE ++ D ++ SVG: PAGE and D are ASCII; the SVG goes in as its exact bytes.
  const html = Buffer.concat([Buffer.from(pageHtml(), "latin1"), Buffer.from(d, "latin1"), art]);
  return { html, lines };
}

/**
 * Parses the command line. Returns null for --help.
 * @param {string[]} args
 */
export function parseArgs(args) {
  /** @type {{midiArg?: string, settings?: string, svg?: string, out: string, serve: number | null}} */
  const opts = { out: DEFAULT_OUT, serve: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") return null;
    if (arg === "--settings" || arg === "--svg" || arg === "--out") {
      const value = args[++i];
      if (value === undefined) throw new PreviewError([`ERROR ${arg} needs a file`, USAGE], 2);
      opts[/** @type {"settings" | "svg" | "out"} */ (arg.slice(2))] = value;
    } else if (arg === "--serve") {
      opts.serve = DEFAULT_PORT;
      if (/^\d+$/.test(args[i + 1] ?? "")) opts.serve = Number(args[++i]);
      if (opts.serve > 65535) throw new PreviewError([`ERROR --serve: no port ${opts.serve}`], 2);
    } else if (arg.startsWith("--")) {
      throw new PreviewError([`ERROR unknown option ${arg}`, USAGE], 2);
    } else if (opts.midiArg === undefined) {
      opts.midiArg = arg;
    } else {
      throw new PreviewError([`ERROR one score at a time (got ${opts.midiArg} and ${arg})`, USAGE], 2);
    }
  }
  if (opts.midiArg === undefined) throw new PreviewError([USAGE], 2);
  return opts;
}

/**
 * Reads a file for an option, as an input error (exit status 2) when it cannot be read.
 * @param {string} path
 */
function readInput(path) {
  try {
    return readFileSync(path);
  } catch (e) {
    throw new PreviewError([`ERROR ${path}: ${/** @type {Error} */ (e).message}`], 2);
  }
}

/**
 * Runs the command line: checks, writes the page and, with --serve, serves it. Returns the exit
 * status, or the server when it serves.
 * @param {string[]} args
 * @param {(line: string) => void} [out]
 * @param {(line: string) => void} [err]
 * @returns {Promise<number | import("node:http").Server>}
 */
export async function run(args, out = console.log, err = console.error) {
  try {
    const opts = parseArgs(args);
    if (!opts) {
      out(USAGE);
      return 0;
    }
    const settings = opts.settings === undefined ? undefined : settingsFromText(opts.settings, readInput(opts.settings).toString("utf8"));
    const svg = opts.svg === undefined ? undefined : readInput(opts.svg);
    const { html, lines } = buildPreview({ midiArg: opts.midiArg ?? "", settings, settingsLabel: opts.settings, svg, svgLabel: opts.svg });
    for (const line of lines) out(line);
    writeFileSync(opts.out, html);
    out(`wrote ${opts.out}: ${html.length} bytes, PAGE ++ D ++ SVG`);
    out(`  page ${VERSION}: it must equal the class's version()`);
    const port = opts.serve;
    if (port === null) return 0;
    const name = `/${basename(opts.out)}`;
    const server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0];
      if (path !== "/" && path !== name) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(html);
    });
    await new Promise((ok, fail) => server.once("error", fail).listen(port, "127.0.0.1", () => ok(undefined)));
    const address = /** @type {import("node:net").AddressInfo} */ (server.address());
    out(`serving http://127.0.0.1:${address.port}/ (Ctrl-C to stop; in a dev container, forward port ${address.port} first)`);
    return server;
  } catch (e) {
    if (!(e instanceof PreviewError)) throw e;
    for (const line of e.lines) (e.status === 2 ? err : out)(line);
    return e.status;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const status = await run(process.argv.slice(2));
  if (typeof status === "number") process.exitCode = status;
}
