#!/usr/bin/env node
// @ts-check
// Checks MIDI files against the page's MIDI contract (README: "MIDI contract") with the page's own
// `checkMidi` and `decodeMidi` from player/player.js, so a score passes here exactly when the player
// in this checkout loads it. Node built-ins only, but it imports player/player.js: run it from a
// checkout of this repository.
//
// Usage: node scripts/check_midi.mjs <input>...
//
// Each input is one of:
//   - a MIDI file (.mid or .midi, or any file that starts with "MThd"): its bytes go to checkMidi;
//   - a JSON file (.json, or any file that starts with "{" or "["): every "midi_b64" string in it, at
//     any depth, goes to decodeMidi, as the page decodes its MIDI block, named by the "name" string
//     next to it (the fixture shape of tests/fixtures/page.json and tests/fixtures/midi/scores.json);
//   - any other text file: its text, without line breaks and spaces, as base64 (decodeMidi);
//   - "-": standard input, read like a file;
//   - an argument that is not a file and starts with "TVRoZA" (base64 of "MThd", how every MIDI
//     file's base64 starts): a base64 string.
//
// For each score it prints PASS or FAIL and the size in bytes; for a failure, the player's exact
// error; for a pass, the loop length in seconds, maxTick (the End-of-Track tick the player loops at),
// and a track and channel summary, including whether channel 10 (drums) is used. The summary is read
// from the file after the check passes; it never changes the verdict.
//
// Exit status: 0 if every score passes, 1 if any fails, 2 on a usage error or an input that cannot be
// read (a missing file, invalid JSON, or JSON with no "midi_b64" string).

import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkMidi, decodeMidi } from "../player/player.js";

const USAGE = "usage: node scripts/check_midi.mjs <file.mid | file.json | base64 file | - | base64 string>...";
/** Base64 of "MThd": the start of every Standard MIDI File in base64. */
const B64_MAGIC = "TVRoZA";
/** The percussion channel (channel 10). */
const DRUMS = 9;
const DRUM_LOW = 35;
const DRUM_HIGH = 81;

/** @typedef {{label: string, bytes?: Uint8Array, b64?: string}} Score raw MIDI bytes, or base64 text */
/**
 * @typedef {{endTick: number, notes: number, channels: number[]}} TrackSummary
 * @typedef {{notes: number, programs: number[], drumNotes: number[]}} ChannelSummary
 * @typedef {{format: number, division: number, tracks: TrackSummary[], channels: Map<number, ChannelSummary>,
 *   rhythmSysEx: boolean}} Summary rhythmSysEx: a GS "use for rhythm part" SysEx, which TinySynth honours
 * @typedef {{label: string, size: number | null, ok: true, maxTick: number, seconds: number, summary: Summary}
 *   | {label: string, size: number | null, ok: false, error: string}} Result
 */

/** An input that cannot be read: exit status 2. */
export class InputError extends Error {}

/**
 * The scores in a file's contents. `ext` is the file's extension (lowercase, "" for stdin).
 * @param {string} label
 * @param {Buffer} buf
 * @param {string} ext
 * @returns {Score[]}
 */
export function scoresFromContents(label, buf, ext) {
  if (ext === ".mid" || ext === ".midi" || buf.subarray(0, 4).toString("latin1") === "MThd") return [{ label, bytes: new Uint8Array(buf) }];
  const text = buf.toString("latin1").trim();
  if (ext === ".json" || text.startsWith("{") || text.startsWith("[")) return scoresFromJson(label, buf.toString("utf8"));
  // Printable ASCII: base64 text, whose line breaks (`base64` wraps at 76 columns) are transport, not
  // data. Anything else is taken as (broken) MIDI bytes, for checkMidi to name.
  const b64 = text.replace(/\s+/g, "");
  if (/^[\x21-\x7e]*$/.test(b64)) return [{ label, b64 }];
  return [{ label, bytes: new Uint8Array(buf) }];
}

/**
 * Every "midi_b64" string in a JSON document, at any depth, labelled with its path and the "name"
 * string next to it. A "midi_b64" that holds an object or array is searched too; one that holds a
 * number, boolean or null is an input error, so a broken fixture is never skipped silently.
 * @param {string} label
 * @param {string} json
 * @returns {Score[]}
 */
export function scoresFromJson(label, json) {
  let doc;
  try {
    doc = JSON.parse(json);
  } catch (e) {
    throw new InputError(`${label}: not valid JSON (${/** @type {Error} */ (e).message})`);
  }
  /** @type {Score[]} */
  const scores = [];
  /** @param {unknown} node @param {string} path */
  const walk = (node, path) => {
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (node && typeof node === "object") {
      const o = /** @type {Record<string, unknown>} */ (node);
      if (typeof o.midi_b64 === "string") {
        const where = [path, typeof o.name === "string" ? o.name : ""].filter(Boolean).join(" ");
        scores.push({ label: `${label}: ${where || "midi_b64"}`, b64: o.midi_b64 });
      }
      for (const [k, v] of Object.entries(o)) {
        const at = path ? `${path}.${k}` : k;
        if (k === "midi_b64" && typeof v !== "string" && (v === null || typeof v !== "object")) {
          throw new InputError(`${label}: ${at} is not a string`);
        }
        if (k !== "midi_b64" || typeof v !== "string") walk(v, at);
      }
    }
  };
  walk(doc, "");
  if (!scores.length) throw new InputError(`${label}: no "midi_b64" string in the JSON`);
  return scores;
}

/**
 * The scores of one command-line argument.
 * @param {string} arg
 * @returns {Score[]}
 */
export function scoresFromArg(arg) {
  if (arg === "-") return scoresFromContents("stdin", readFileSync(0), "");
  /** @type {import("node:fs").Stats | undefined} */
  let stat;
  try {
    stat = statSync(arg);
  } catch {
    if (arg.startsWith(B64_MAGIC)) return [{ label: `base64 argument (${arg.length} characters)`, b64: arg }];
    throw new InputError(`${arg}: no such file (a base64 argument must start with ${B64_MAGIC})`);
  }
  if (!stat.isFile()) throw new InputError(`${arg}: not a file`);
  return scoresFromContents(arg, readFileSync(arg), extname(arg).toLowerCase());
}

/**
 * Checks one score as the page does: raw bytes with `checkMidi`, base64 with `decodeMidi`.
 * @param {Score} score
 * @returns {Result}
 */
export function checkScore(score) {
  const { label } = score;
  let size = score.bytes ? score.bytes.length : null;
  try {
    const bytes = score.bytes ?? decodeMidi(/** @type {string} */ (score.b64));
    size = bytes.length;
    const { maxTick, seconds } = checkMidi(bytes);
    return { label, size, ok: true, maxTick, seconds, summary: summarize(bytes) };
  } catch (e) {
    const error = String((e && /** @type {Error} */ (e).message) || e);
    // decodeMidi rejected the file, not its base64: its size is that of the decoded base64.
    if (size === null && error !== "midi: not base64") size = Buffer.from(/** @type {string} */ (score.b64).replace(/^ +| +$/g, ""), "base64").length;
    return { label, size, ok: false, error };
  }
}

/**
 * Tracks and channels of a file that passed `checkMidi` (so it is well formed: this does not
 * re-check it). Channels are 0-based here.
 * @param {Uint8Array} u
 * @returns {Summary}
 */
export function summarize(u) {
  const u16 = (/** @type {number} */ i) => (u[i] << 8) | u[i + 1];
  let p = 14;
  const vlq = () => {
    let v = 0;
    let b;
    do {
      b = u[p++];
      v = v * 128 + (b & 127);
    } while (b & 128);
    return v;
  };
  /** @type {Map<number, {notes: number, programs: Set<number>, drumNotes: Set<number>}>} */
  const channels = new Map();
  /** @type {TrackSummary[]} */
  const tracks = [];
  let rhythmSysEx = false;
  for (let t = 0; t < u16(10); t++) {
    const end = p + 8 + u16(p + 4) * 65536 + u16(p + 6);
    p += 8;
    let tick = 0;
    let run = 0;
    let notes = 0;
    const used = new Set();
    while (p < end) {
      tick += vlq();
      let st = u[p];
      if (st < 128) st = run;
      else p++;
      if (st === 0xff || st === 0xf0) {
        if (st === 0xff) p++; // the meta event's type
        const n = vlq(); // read before adding: `p += vlq()` would add to the old p
        // GS use for rhythm part, F0 41 dd 42 12 40 1x 15 vv cs F7, as TinySynth's send() matches it.
        if (st === 0xf0 && n === 10 && u[p] === 0x41 && u[p + 2] === 0x42 && u[p + 3] === 0x12 && u[p + 4] === 0x40 && (u[p + 5] & 0xf0) === 0x10 && u[p + 6] === 0x15) rhythmSysEx = true;
        p += n;
      } else {
        run = st;
        const kind = st & 0xf0;
        const ch = st & 15;
        const d1 = u[p++];
        const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : u[p++];
        let c = channels.get(ch);
        if (!c) channels.set(ch, (c = { notes: 0, programs: new Set(), drumNotes: new Set() }));
        used.add(ch);
        if (kind === 0x90 && d2 > 0) {
          notes++;
          c.notes++;
          if (ch === DRUMS) c.drumNotes.add(d1);
        } else if (kind === 0xc0) c.programs.add(d1);
      }
    }
    tracks.push({ endTick: tick, notes, channels: [...used].sort((a, b) => a - b) });
  }
  const sorted = (/** @type {Set<number>} */ s) => [...s].sort((a, b) => a - b);
  return {
    format: u16(8),
    division: u16(12),
    tracks,
    channels: new Map(
      [...channels.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([ch, c]) => [ch, { notes: c.notes, programs: sorted(c.programs), drumNotes: sorted(c.drumNotes) }]),
    ),
    rhythmSysEx,
  };
}

const plural = (/** @type {number} */ n, /** @type {string} */ word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const channelName = (/** @type {number} */ ch) => (ch === DRUMS ? "channel 10 (drums)" : `channel ${ch + 1}`);

/**
 * The report lines for one result.
 * @param {Result} r
 * @returns {string[]}
 */
export function formatResult(r) {
  const size = r.size === null ? "size unknown (not base64)" : plural(r.size, "byte");
  if (!r.ok) return [`FAIL ${r.label}`, `  ${r.error}`, `  ${size}`];
  const { format, division, tracks, channels, rhythmSysEx } = r.summary;
  const lines = [
    `PASS ${r.label}`,
    `  ${size}, format ${format}, ${plural(tracks.length, "track")}, ${division} ticks per quarter note`,
    `  loop ${r.seconds.toFixed(3)} s, maxTick ${r.maxTick} (the latest End-of-Track: the player loops there)`,
  ];
  tracks.forEach((t, i) => {
    const on = `${t.channels.length > 1 ? "channels" : "channel"} ${t.channels.map((ch) => ch + 1).join(", ")}`;
    const events = t.channels.length ? `${plural(t.notes, "note")} on ${on}` : "no channel events";
    lines.push(`  track ${i + 1}: End-of-Track at tick ${t.endTick}, ${events}`);
  });
  for (const [ch, c] of channels) {
    if (ch === DRUMS) {
      const silent = c.drumNotes.filter((n) => n < DRUM_LOW || n > DRUM_HIGH);
      const notes = c.drumNotes.length ? `, drum notes ${c.drumNotes.join(", ")}` : "";
      const warn = silent.length && !rhythmSysEx ? ` (silent, outside ${DRUM_LOW}-${DRUM_HIGH}: ${silent.join(", ")})` : "";
      lines.push(`  ${channelName(ch)}: ${plural(c.notes, "note")}${notes}${warn}`);
    } else {
      const programs = c.programs.length ? `programs ${c.programs.join(", ")}` : "no program change (program 0)";
      lines.push(`  ${channelName(ch)}: ${plural(c.notes, "note")}, ${programs}`);
    }
  }
  if (!channels.has(DRUMS)) lines.push(`  ${channelName(DRUMS)}: not used`);
  if (rhythmSysEx) lines.push("  note: a GS use-for-rhythm-part SysEx can change which channels are drums; this summary assumes channel 10 only");
  return lines;
}

/**
 * Runs the check on the command-line arguments and returns the exit status.
 * @param {string[]} args
 * @param {(line: string) => void} [out]
 * @param {(line: string) => void} [err]
 */
export function run(args, out = console.log, err = console.error) {
  if (args.length === 1 && (args[0] === "-h" || args[0] === "--help")) {
    out(USAGE);
    return 0;
  }
  if (!args.length) {
    err(USAGE);
    return 2;
  }
  let status = 0;
  let passed = 0;
  let failed = 0;
  for (const arg of args) {
    let scores;
    try {
      scores = scoresFromArg(arg);
    } catch (e) {
      if (!(e instanceof InputError) && !(e && /** @type {any} */ (e).code)) throw e;
      err(`ERROR ${/** @type {Error} */ (e).message}`);
      status = 2;
      continue;
    }
    for (const score of scores) {
      const result = checkScore(score);
      for (const line of formatResult(result)) out(line);
      if (result.ok) passed++;
      else {
        failed++;
        status = Math.max(status, 1);
      }
    }
  }
  if (passed + failed > 1) out(`${plural(passed + failed, "score")}: ${passed} passed, ${failed} failed`);
  return status;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
