// @ts-check
// Inputs of the page golden fixtures: (MIDI, SETTINGS, SVG, JSON members) per case, plus invalid
// settings that midi_segment must reject. `gen_page_fixtures.mjs` computes the expected outputs
// with the JS reference (scripts/page.mjs) and writes tests/fixtures/page.json and
// tests/page_fixtures.cairo. The browser and Node checks of the page use the same inputs.
//
// The valid cases cover every D padding length (0..8) and every consumer padding length (0..2 for
// the head and for S): each case's MIDI carries a text meta event whose length the generator tunes
// to give the case its D pad.

import { INVALID, VALID } from "./settings_fixtures.mjs";

/** @typedef {import("../player/settings.js").SynthSettings} SynthSettings */

/** Big-endian unsigned integer bytes. */
const be = (/** @type {number} */ v, /** @type {number} */ n) => Array.from({ length: n }, (_, i) => (v >>> (8 * (n - 1 - i))) & 255);

/** MIDI variable-length quantity. */
function vlq(/** @type {number} */ v) {
  const out = [v & 127];
  while ((v >>>= 7)) out.unshift((v & 127) | 128);
  return out;
}

/**
 * A Standard MIDI File. Each track is a list of events `[delta ticks, ...event bytes]`, written as
 * given (running status included); End-of-Track must be the last event of every track.
 * @param {{format?: number, ppq: number, tracks: number[][][]}} song
 */
export function smf({ format = 0, ppq, tracks }) {
  const chunks = tracks.map((events) => {
    const body = events.flatMap(([delta, ...ev]) => [...vlq(delta), ...ev]);
    return [..."MTrk"].map((c) => c.charCodeAt(0)).concat(be(body.length, 4), body);
  });
  const head = [..."MThd"].map((c) => c.charCodeAt(0)).concat(be(6, 4), be(format, 2), be(tracks.length, 2), be(ppq, 2));
  return Buffer.from(head.concat(...chunks));
}

/** Text meta event (FF 01) at delta 0. */
const text = (/** @type {string} */ s) => [0, 0xff, 0x01, ...vlq(s.length), ...Buffer.from(s, "latin1")];
/** Tempo meta event (FF 51) at delta 0. */
const tempo = (/** @type {number} */ us) => [0, 0xff, 0x51, 0x03, ...be(us, 3)];
/** End-of-Track `delta` ticks after the previous event. */
const eot = (/** @type {number} */ delta) => [delta, 0xff, 0x2f, 0x00];

/**
 * A riff of `bars` 4/4 bars: on every beat a lead note on channel 1 (program `program`) and a
 * kick (36) or snare (38) on channel 10, with running status and velocity-0 note-offs. The last
 * event is the final note-off a sixteenth before the bar line; End-of-Track is on the bar line.
 * @param {{ppq: number, us: number, bars?: number, program?: number, label?: string, format1?: boolean, sysex?: boolean}} o
 */
export function riff({ ppq, us, bars = 1, program = 0, label = "", format1 = false, sysex = false }) {
  const notes = [72, 76, 79, 84];
  const meta = [tempo(us), [0, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]];
  if (label) meta.push(text(label));
  /** @type {number[][]} */
  const ev = [[0, 0xc0, program], [0, 0xb0, 0x07, 0x64], [0, 0xb9, 0x07, 0x5a]];
  if (sysex) ev.unshift([0, 0xf0, 0x05, 0x7e, 0x7f, 0x09, 0x01, 0xf7]); // GM System On
  const sixteenth = ppq / 4;
  for (let beat = 0; beat < 4 * bars; beat++) {
    const n = notes[beat % 4];
    ev.push([beat ? sixteenth : 0, 0x90, n, 0x60], [0, 0x99, beat % 2 ? 38 : 36, 0x64]);
    ev.push([sixteenth, beat % 2 ? 38 : 36, 0x00]); // running status: drum off (velocity 0)
    ev.push([2 * sixteenth, 0x90, n, 0x00]);
  }
  ev.push(eot(sixteenth));
  return format1 ? smf({ format: 1, ppq, tracks: [[...meta, eot(4 * bars * ppq)], ev] }) : smf({ ppq, tracks: [[...meta, ...ev]] });
}

// ---------------------------------------------------------------------------------------------
// SVG art
// ---------------------------------------------------------------------------------------------

/** A card with a title and an animated border (the Beasts shape). */
export const cardSvg = (/** @type {string} */ title) =>
  "<svg xmlns='http://www.w3.org/2000/svg' width='250' height='350' viewBox='0 0 250 350'>" +
  "<rect width='250' height='350' rx='12' fill='#1e1e22'/>" +
  "<rect x='4.5' y='4.5' width='241' height='341' rx='9' fill='none' stroke='#b79a5e' stroke-width='4'>" +
  "<animate attributeName='stroke-opacity' values='1;0.4;1' dur='2s' repeatCount='indefinite'/></rect>" +
  `<text x='125' y='42' text-anchor='middle' fill='#fff' font-family='monospace' font-size='20'>${title}</text>` +
  "</svg>";

/**
 * The art-restart probe: a white bar sweeps linearly from x = 0 to x = 390 over `seconds` and
 * stays there, so the bar's position tells how long the image's animation has run.
 */
export const sweepSvg = (/** @type {number} */ seconds) =>
  "<svg xmlns='http://www.w3.org/2000/svg' width='400' height='100' viewBox='0 0 400 100'>" +
  "<rect width='400' height='100' fill='#000'/>" +
  `<rect width='10' height='100' fill='#fff'><animate attributeName='x' from='0' to='390' dur='${seconds}s' fill='freeze'/></rect>` +
  "</svg>";

/** Non-ASCII text: the player must re-encode the art block as UTF-8. */
export const unicodeSvg =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 100'><rect width='300' height='100' fill='#203'/>" +
  "<text x='150' y='60' text-anchor='middle' fill='#fd0' font-size='28'>Ünïcødé ✦ 音楽</text></svg>";

// ---------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------

const settingsNamed = (/** @type {string} */ name) => {
  const f = VALID.find((v) => v.name === name);
  if (!f) throw new Error(`no settings fixture ${name}`);
  return f.settings;
};

/**
 * Valid cases. `midi(label)` builds the case's MIDI with a text meta event `label`, which the
 * generator lengthens to reach the case's D pad (`dPad`).
 * @type {Array<{name: string, dPad: number, settings: SynthSettings, midi: (label: string) => Buffer, svg: string, members: string}>}
 */
export const CASES = [
  {
    name: "default_120bpm",
    dPad: 0,
    settings: settingsNamed("default"),
    midi: (label) => riff({ ppq: 96, us: 500000, label }),
    svg: cardSvg("Default"),
    members: '"name":"Default"',
  },
  {
    name: "beast_140bpm",
    dPad: 1,
    settings: settingsNamed("beast_reference"),
    midi: (label) => riff({ ppq: 96, us: 428571, label }),
    svg: sweepSvg(8),
    members: '"name":"Beast sweep","description":"Art-restart probe"',
  },
  {
    name: "six_timbres_format1",
    dPad: 2,
    settings: settingsNamed("six_timbres"),
    midi: (label) => riff({ ppq: 480, us: 600000, label, format1: true }),
    svg: cardSvg("Six timbres"),
    members: '"name":"Six","attributes":[{"trait_type":"Tier","value":"1"}]',
  },
  {
    name: "unicode_art",
    dPad: 3,
    settings: settingsNamed("beast_reference"),
    midi: (label) => riff({ ppq: 96, us: 500000, label, sysex: true }),
    svg: unicodeSvg,
    members: '"name":"Ünïcødé"',
  },
  {
    name: "min_fields",
    dPad: 4,
    settings: settingsNamed("min_fields"),
    midi: (label) => riff({ ppq: 48, us: 500000, program: 35, label }),
    svg: cardSvg("Min"),
    members: '"name":"Min fields!"',
  },
  {
    name: "max_fields",
    dPad: 5,
    settings: settingsNamed("max_fields"),
    midi: (label) => riff({ ppq: 96, us: 500000, program: 127, label }),
    svg: cardSvg("Max"),
    members: '"name":"Max fields"',
  },
  {
    name: "slot_edges",
    dPad: 6,
    settings: settingsNamed("slot_edges"),
    midi: (label) => riff({ ppq: 192, us: 375000, label }),
    svg: cardSvg("Slots"),
    members: '"name":"Slot edges and more"',
  },
  {
    name: "all_builtin_waves",
    dPad: 7,
    settings: settingsNamed("all_builtin_waves"),
    midi: (label) => riff({ ppq: 96, us: 500000, program: 1, label }),
    svg: cardSvg("Waves"),
    members: '"name":"Waves","description":"Every built-in waveform"',
  },
  {
    name: "every_slot",
    dPad: 8,
    settings: settingsNamed("every_slot"),
    midi: (label) => riff({ ppq: 96, us: 500000, label }),
    svg: cardSvg("Long"),
    members: '"name":"All timbre slots"',
  },
];

/** Invalid settings: midi_segment must revert with the same panic data as `settings::validate`. */
export const INVALID_CASES = ["quality_2", "fm_on_itself", "duplicate_drum", "custom_wave", "filter", "timbres_176"].map((name) => {
  const f = INVALID.find((v) => v.name === name);
  if (!f) throw new Error(`no invalid settings fixture ${name}`);
  return { name, settings: f.settings, error: f.error };
});

/** The MIDI of the invalid cases (they revert before it matters). */
export const INVALID_MIDI = riff({ ppq: 96, us: 500000 });
