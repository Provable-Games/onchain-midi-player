#!/usr/bin/env node
// @ts-check
// Synthetic MIDI scores for the gas measurements (tests/test_class_gas.cairo, through
// tests/class_fixtures.cairo) and the example's token 4 (examples/beast_consumer), written to
// tests/fixtures/midi/scores.json. Node built-ins only, plus the page's own MIDI check.
//
// Each score is a five-voice round in a key and scale. A seeded subject runs over a four-chord
// progression of two beats per chord, so the harmony repeats every two bars. Every voice plays the
// subject in its own octave, entering two bars after the previous voice, so all the voices always
// sound over the same chord. Strong beats take chord tones, weak beats step through the scale, and
// each voice closes with a cadence that ends on the tonic.
//
// The scores stand in for the onchain composer's production scores: they have exactly their sizes
// (816, 1,541, 2,266, 2,991 and 3,716 bytes), so every gas figure that depends on the MIDI length
// is unchanged, and their structure:
//   - Standard MIDI File format 1 at 480 ticks per quarter: a tempo track (one tempo meta event)
//     and five voice tracks on channels 0-4;
//   - notes on a quarter-note grid (starts and lengths are multiples of 480 ticks), velocities
//     90-127;
//   - a status byte on every event (no running status), note-offs as 0x80 with velocity 64;
//   - End-of-Track closing every track, chunk lengths exact.
//
// Sizes are fitted after composing. The subject grows by half-bar cells while the score still
// fits, then the cadences take up the rest: each cadence note adds 9 bytes (a note-on and a
// note-off) and each breath, a quarter rest before a cadence note, adds 1 byte (that note's delta
// takes two bytes instead of one). Every score is then checked against its target size, the
// page's checkMidi, a loop length of 12-63 s and the grid and velocity rules; any miss fails the
// run. scripts/gen_midi_fixtures.test.mjs checks the bytes independently.
//
// Usage (repository root):
//   node scripts/gen_midi_fixtures.mjs           write tests/fixtures/midi/scores.json
//   node scripts/gen_midi_fixtures.mjs --check   exit 1 if it is out of date

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkMidi } from "../player/player.js";

export const SCORES_PATH = fileURLToPath(new URL("../tests/fixtures/midi/scores.json", import.meta.url));

/** Ticks per quarter note. */
export const PPQ = 480;
/** Loop length bounds, in seconds (the production scores loop for 12.74 to 63 s). */
export const LOOP_SECONDS = { min: 12, max: 63 };
/** One pass of the progression in quarters (two bars of 4/4), and the gap between voice entries. */
const PERIOD = 8;
/** Each voice's register, in scale degrees from the subject's (7 is an octave). */
const VOICE_OFFSETS = [7, 0, -7, 7, 0];
/** The subject's range, in scale degrees from the tonic. */
const RANGE = { lo: -2, hi: 7 };
/** Rhythm cells for half a bar, in quarters (a negative length is a rest), repeated as weights. */
const CELLS = [[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [2], [1, -1]];

/** Scales as semitones above the tonic. */
const SCALES = /** @type {const} */ ({
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],
});
const PITCH_CLASSES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * @typedef {{name: string, bytes: number, tempoUs: number, seed: number, key: keyof typeof PITCH_CLASSES,
 *   scale: keyof typeof SCALES, progression: number[]}} ScoreSpec
 * `progression`: the chord roots, as scale degrees (1 is the tonic), two beats each.
 */

/**
 * One score per production size, named after the size slot it fills (the Cairo fixtures and gas
 * tests use these names). `bytes` and `tempoUs` are the production score's size and tempo.
 * @type {ScoreSpec[]}
 */
export const SCORES = [
  { name: "genesis", bytes: 816, tempoUs: 455000, seed: 101, key: "D", scale: "dorian", progression: [1, 4, 1, 7] },
  { name: "threshold_1", bytes: 1541, tempoUs: 500000, seed: 202, key: "A", scale: "minor", progression: [1, 6, 3, 7] },
  { name: "threshold_3", bytes: 2266, tempoUs: 500000, seed: 303, key: "F", scale: "major", progression: [1, 6, 4, 5] },
  { name: "veteran", bytes: 2991, tempoUs: 500000, seed: 404, key: "E", scale: "harmonic_minor", progression: [1, 4, 5, 1] },
  { name: "heaviest", bytes: 3716, tempoUs: 455000, seed: 505, key: "G", scale: "mixolydian", progression: [1, 7, 4, 1] },
];

/**
 * mulberry32: a small, well-known 32-bit PRNG. Returns floats in [0, 1).
 * @param {number} seed
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mod7 = (/** @type {number} */ d) => ((d % 7) + 7) % 7;

/** @typedef {{q: number, len: number, deg: number, vel: number}} Note  q, len in quarters */

/**
 * The subject: `cells` half-bar cells of the seeded melody, as notes in quarters from its start.
 * The cells come from one PRNG stream, so a shorter subject is a prefix of a longer one.
 * @param {ScoreSpec} spec
 * @param {number} cells
 * @returns {Note[]}
 */
function subject(spec, cells) {
  const rand = mulberry32(spec.seed);
  const pick = (/** @type {number} */ n) => Math.floor(rand() * n);
  const root = (/** @type {number} */ q) => spec.progression[Math.floor(q / 2) % 4] - 1;
  /** @type {Note[]} */
  const notes = [];
  let deg = 4;
  for (let c = 0; c < cells; c++) {
    let q = 2 * c;
    for (const len of CELLS[pick(CELLS.length)]) {
      if (len < 0) {
        q -= len;
        continue;
      }
      if (q % 2 === 0) {
        // Strong beat: a chord tone near the last note, not a repeat of it.
        const r = root(q);
        const near = [];
        for (let d = Math.max(RANGE.lo, deg - 4); d <= Math.min(RANGE.hi, deg + 4); d++) {
          if (d !== deg && [0, 2, 4].includes(mod7(d - r))) near.push(d);
        }
        deg = near[pick(near.length)];
      } else {
        // Weak beat: a step up or down the scale, turned back at the edges of the range.
        const step = pick(2) ? 1 : -1;
        deg = deg + step > RANGE.hi || deg + step < RANGE.lo ? deg - step : deg + step;
      }
      const accent = q % 4 === 0 ? 110 : q % 2 === 0 ? 100 : 92;
      notes.push({ q, len, deg, vel: accent + pick(6) });
      q += len;
    }
  }
  return notes;
}

/**
 * Every voice's notes: the subject, entering `PERIOD` quarters after the previous voice, then its
 * cadence. `codaNotes[v]` notes close voice v (at least one); the last lands on the tonic at the
 * start of a tonic chord. `breaths[v][i]` puts a quarter rest before voice v's cadence note i.
 * @param {ScoreSpec} spec
 * @param {Note[]} sub
 * @param {number} cells
 * @param {number[]} codaNotes
 * @param {boolean[][]} breaths
 * @returns {Note[][]}
 */
function voices(spec, sub, cells, codaNotes, breaths) {
  const root = (/** @type {number} */ q) => spec.progression[Math.floor(q / 2) % 4] - 1;
  return VOICE_OFFSETS.map((offset, v) => {
    const entry = PERIOD * v;
    const notes = sub.map((n) => ({ ...n, q: entry + n.q, deg: n.deg + offset }));
    let deg = sub[sub.length - 1].deg;
    let at = entry + 2 * cells;
    // The cadence follows the subject without a gap: a trailing rest becomes part of its last note.
    const tail = notes[notes.length - 1];
    tail.len = at - tail.q;
    for (let i = 0; i < codaNotes[v]; i++) {
      const last = notes[notes.length - 1];
      const rest = breaths[v][i] ? 1 : 0;
      if (i < codaNotes[v] - 1) {
        // A chord tone near the last note, as a half note.
        const r = root(at + rest);
        let best = deg;
        for (const d of [deg - 1, deg + 1, deg - 2, deg + 2, deg - 3, deg + 3]) {
          if (best === deg && [0, 2, 4].includes(mod7(d - r))) best = d;
        }
        deg = best;
        notes.push({ q: at + rest, len: 2, deg: deg + offset, vel: 100 });
        at += rest + 2;
      } else {
        // The tonic nearest the last note, held for a bar from the next tonic chord; the note before
        // it is lengthened to meet it (or the breath).
        let start = at + rest;
        while (start % 2 !== 0 || root(start) !== 0) start++;
        last.len = start - rest - last.q;
        deg = Math.round(deg / 7) * 7;
        notes.push({ q: start, len: 4, deg: deg + offset, vel: 108 });
      }
    }
    return notes;
  });
}

/**
 * MIDI variable-length quantity.
 * @param {number} n
 */
function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

/**
 * A chunk: 4-byte tag, 32-bit big-endian length, data.
 * @param {string} tag
 * @param {number[]} data
 */
function chunk(tag, data) {
  const len = data.length;
  return [...Buffer.from(tag, "latin1"), len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...data];
}

/**
 * The Standard MIDI File: format 1, a tempo track, then one track per voice on channel v, every
 * event with its status byte, note-offs as 0x80 with velocity 64.
 * @param {ScoreSpec} spec
 * @param {Note[][]} parts
 */
function smf(spec, parts) {
  const tonic = PITCH_CLASSES[spec.key] <= 6 ? 60 + PITCH_CLASSES[spec.key] : 48 + PITCH_CLASSES[spec.key];
  const scale = SCALES[spec.scale];
  const pitch = (/** @type {number} */ deg) => tonic + 12 * Math.floor(deg / 7) + scale[mod7(deg)];
  const t = spec.tempoUs;
  const out = [
    ...chunk("MThd", [0, 1, 0, 1 + parts.length, PPQ >> 8, PPQ & 255]),
    ...chunk("MTrk", [0x00, 0xff, 0x51, 0x03, t >>> 16, (t >>> 8) & 255, t & 255, 0x00, 0xff, 0x2f, 0x00]),
  ];
  parts.forEach((notes, ch) => {
    const ev = [];
    let tick = 0;
    for (const n of notes) {
      const p = pitch(n.deg);
      ev.push(...vlq(n.q * PPQ - tick), 0x90 | ch, p, n.vel);
      ev.push(...vlq(n.len * PPQ), 0x80 | ch, p, 0x40);
      tick = (n.q + n.len) * PPQ;
    }
    ev.push(0x00, 0xff, 0x2f, 0x00);
    out.push(...chunk("MTrk", ev));
  });
  return Buffer.from(out);
}

/**
 * The score for `cells` subject cells and `coda` cadence notes in all, `breaths` of them after a
 * rest. Cadence notes: one per voice, then one more per voice from the last voice to enter back to
 * the first. Breaths: before each voice's first cadence note in turn, then its second, and so on.
 * @param {ScoreSpec} spec
 * @param {number} cells
 * @param {number} coda
 * @param {number} breaths
 */
function build(spec, cells, coda, breaths) {
  const n = VOICE_OFFSETS.length;
  const codaNotes = VOICE_OFFSETS.map((_, v) => 1 + Math.floor((coda - n) / n) + (n - 1 - v < (coda - n) % n ? 1 : 0));
  const rests = VOICE_OFFSETS.map((_, v) => Array.from({ length: codaNotes[v] }, () => false));
  for (let i = 0, left = breaths; left > 0; i++) {
    for (let v = 0; v < n && left > 0; v++) {
      if (i < codaNotes[v]) {
        rests[v][i] = true;
        left--;
      }
    }
  }
  const parts = voices(spec, subject(spec, cells), cells, codaNotes, rests);
  return { midi: smf(spec, parts), parts };
}

/**
 * Composes `spec` at exactly `spec.bytes` bytes: the longest subject for which some cadence fits
 * (5 to 15 cadence notes, at most one breath each and at most 8 in all), the fewest cadence notes,
 * then the fewest breaths.
 * @param {ScoreSpec} spec
 */
export function compose(spec) {
  const n = VOICE_OFFSETS.length;
  let cells = 1;
  while (build(spec, cells + 1, n, 0).midi.length <= spec.bytes) cells++;
  for (; cells > 0; cells--) {
    for (let coda = n; coda <= 3 * n; coda++) {
      for (let breaths = 0; breaths <= Math.min(coda, 8); breaths++) {
        const { midi, parts } = build(spec, cells, coda, breaths);
        if (midi.length === spec.bytes) return { midi, parts, cells, coda, breaths };
      }
    }
  }
  throw new Error(`${spec.name}: no subject and cadence give exactly ${spec.bytes} bytes`);
}

/**
 * @param {boolean} cond
 * @param {string} msg
 */
function check(cond, msg) {
  if (!cond) throw new Error(`check failed: ${msg}`);
}

/** Every score, composed and checked. */
export function buildScores() {
  return SCORES.map((spec) => {
    const { midi, parts } = compose(spec);
    const { maxTick, seconds } = checkMidi(midi);
    check(midi.length === spec.bytes, `${spec.name}: ${midi.length} bytes, not ${spec.bytes}`);
    check(maxTick === Math.max(...parts.map((p) => (p[p.length - 1].q + p[p.length - 1].len) * PPQ)), `${spec.name}: End-of-Track`);
    check(seconds >= LOOP_SECONDS.min && seconds <= LOOP_SECONDS.max, `${spec.name}: loop of ${seconds} s`);
    for (const p of parts) {
      for (let i = 0; i < p.length; i++) {
        const { q, len, vel } = p[i];
        check(Number.isInteger(q) && Number.isInteger(len) && len > 0, `${spec.name}: off the quarter grid`);
        check(i === 0 || q >= p[i - 1].q + p[i - 1].len, `${spec.name}: overlapping notes in a voice`);
        check(vel >= 90 && vel <= 127, `${spec.name}: velocity ${vel}`);
      }
    }
    // One pass in microseconds is an integer (whole quarters times the tempo): rounded to the ms.
    const passUs = (maxTick / PPQ) * spec.tempoUs;
    return {
      name: spec.name,
      bytes: midi.length,
      tempo_us: spec.tempoUs,
      duration_seconds: Math.round(passUs / 1000) / 1000,
      notes: parts.reduce((sum, p) => sum + p.length, 0),
      params: { seed: spec.seed, key: spec.key, scale: spec.scale.replace("_", " "), progression: spec.progression },
      sha256: createHash("sha256").update(midi).digest("hex"),
      midi_b64: midi.toString("base64"),
    };
  });
}

/** tests/fixtures/midi/scores.json. */
export function generate() {
  const scores = buildScores();
  const json = JSON.stringify(
    {
      _comment:
        "Synthetic MIDI scores generated by scripts/gen_midi_fixtures.mjs: do not edit, run `node scripts/gen_midi_fixtures.mjs`. " +
        "Five-voice rounds with the sizes and structure of the onchain composer's production scores; see tests/fixtures/midi/README.md.",
      scores,
    },
    null,
    1,
  ) + "\n";
  return { json, scores };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { json, scores } = generate();
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(SCORES_PATH, "utf8");
    } catch {
      // A missing file is out of date.
    }
    if (current !== json) {
      console.error(`out of date: ${SCORES_PATH} (run node scripts/gen_midi_fixtures.mjs)`);
      process.exit(1);
    }
    process.exit(0);
  }
  writeFileSync(SCORES_PATH, json);
  for (const s of scores) {
    console.log(`  ${s.name.padEnd(12)} ${String(s.bytes).padStart(5)} bytes  ${String(s.notes).padStart(3)} notes  ${s.duration_seconds} s  ` +
      `${s.params.key} ${s.params.scale}`);
  }
}
