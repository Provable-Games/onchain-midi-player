// @ts-check
// Pins the engine behaviours that the README's MIDI contract documents and that a composer could not
// guess from the MIDI standard. It runs the pinned TinySynth (scripts/engine.mjs, SHA-256 checked) on
// the WebAudio mock, with its 60 ms scheduler driven by hand. If a re-pinned engine changes one of
// these behaviours, the test fails here: update the README's MIDI contract with it.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import vm from "node:vm";
import { engineSource } from "./engine.mjs";
import { smf } from "./page_fixtures.mjs";
import { webAudioMock } from "./webaudio_mock.mjs";

const EOT = [0xff, 0x2f, 0x00];
const PPQ = 96; // at the default 120 BPM, 96 ticks are 0.5 s

/**
 * The engine on a fresh WebAudio mock, with every note it plays recorded: its time, channel, note,
 * timbre and the frequency of its first oscillator.
 */
function engine({ voices = 64 } = {}) {
  const { AudioContext, log, nodes, contexts } = webAudioMock();
  /** @type {Function[]} */
  const timers = [];
  const sandbox = { AudioContext, performance: { now: () => 0 }, setInterval: (/** @type {Function} */ fn) => timers.push(fn), clearInterval() {}, console };
  vm.createContext(sandbox);
  vm.runInContext(engineSource(), sandbox);
  const synth = /** @type {any} */ (new /** @type {any} */ (sandbox).WebAudioTinySynth({ quality: 1, useReverb: 0, voices }));
  const ctx = contexts[0];
  /** @type {Array<{t: number, ch: number, n: number, p: any, freq: number, oscs: string[]}>} */
  const notes = [];
  const note = synth._note;
  synth._note = (/** @type {number} */ t, /** @type {number} */ ch, /** @type {number} */ n, /** @type {number} */ v, /** @type {any} */ p) => {
    const from = log.length;
    note(t, ch, n, v, p);
    const oscs = log.slice(from).filter((c) => c[1] === "create" && c[0].startsWith("osc")).map((c) => c[0]);
    notes.push({ t, ch, n, p, freq: nodes[oscs[0]].frequency.value, oscs });
  };
  /** @type {number[]} */
  const offs = [];
  const noteOff = synth.noteOff;
  synth.noteOff = (/** @type {number} */ ch, /** @type {number} */ n, /** @type {number} */ t) => {
    offs.push(t);
    noteOff(ch, n, t);
  };
  /** Loads and plays a MIDI file as the page's ▶ does (looping at End-of-Track), at the current time. */
  const play = (/** @type {Buffer} */ midi) => {
    synth.loadMIDI(new Uint8Array(midi));
    synth.setLoop(1);
    synth.setLoopEnd(synth.maxTick);
    synth.playMIDI();
  };
  /**
   * Runs the scheduler every 60 ms of audio time until `until`. Returns the time of the first step
   * at which `stopped` oscillators were stopped at once (stop() with no time), or null.
   */
  const run = (/** @type {number} */ until, /** @type {string[]} */ stopped = []) => {
    let at = null;
    for (; ctx.currentTime <= until; ctx.currentTime = Math.round((ctx.currentTime + 0.06) * 1000) / 1000) {
      const from = log.length;
      timers[0]();
      if (at === null && log.slice(from).some((c) => c[1] === "stop" && c[2] === undefined && stopped.includes(c[0]))) at = ctx.currentTime;
    }
    return at;
  };
  return { synth, ctx, log, nodes, notes, offs, play, run };
}

const near = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) < 1e-9;

describe("the pinned engine behaves as the README's MIDI contract says", () => {
  test("loop: a pass ends at End-of-Track; the tempo returns to 120 BPM; the program carries over", () => {
    // Tick 0 note on; tick 96 tempo 240 BPM, note off, program 40; End-of-Track at 192.
    // One pass: 96 ticks at 120 BPM (0.5 s) + 96 ticks at 240 BPM (0.25 s) = 0.75 s.
    const midi = smf({ ppq: PPQ, tracks: [[[0, 0x90, 60, 100], [96, 0xff, 0x51, 0x03, 0x03, 0xd0, 0x90], [0, 0x80, 60, 0], [0, 0xc0, 40], [96, ...EOT]]] });
    const e = engine();
    e.play(midi);
    e.run(1.5);
    const [first, second] = e.notes;
    assert.ok(near(first.t, 0.1) && near(second.t, 0.85), `passes start at ${first.t} and ${second.t}`);
    assert.equal(first.p, e.synth.program[0].p, "the first pass plays the default program 0");
    assert.equal(second.p, e.synth.program[40].p, "the second pass keeps program 40 from the end of the first");
    // The second pass's note-off is 96 ticks in at 120 BPM again (0.5 s), not at 240 BPM (0.25 s).
    assert.ok(near(e.offs[1] - second.t, 0.5), `note-off ${e.offs[1] - second.t} s after the note`);
  });

  test("the voice limit cuts a note when the new note is scheduled, before it sounds", () => {
    // voices 1: a held note at tick 0, and a second note at tick 192 (1 s later).
    const midi = smf({ ppq: PPQ, tracks: [[[0, 0x90, 60, 100], [192, 0x90, 64, 100], [96, 0x80, 60, 0], [0, 0x80, 64, 0], [96, ...EOT]]] });
    const e = engine({ voices: 1 });
    e.play(midi);
    e.run(0); // schedules the first note
    const [held] = e.notes;
    const cut = e.run(1.2, held.oscs);
    const second = e.notes[1];
    assert.ok(cut !== null && near(second.t, 1.1), "the held note is cut");
    assert.ok(cut < second.t && second.t - cut <= 0.2, `cut at ${cut} s, ${second.t - /** @type {number} */ (cut)} s before the new note at ${second.t} s`);
  });

  test("a drum hit takes no voice but applies the voice limit", () => {
    const e = engine({ voices: 2 });
    e.ctx.currentTime = 1; // past the constructor's warm-up note
    e.synth.send([0x90, 60, 100], 1.5);
    e.synth.send([0x90, 64, 100], 1.5);
    const held = () => Array.from(e.synth.notetab, (/** @type {any} */ n) => n.n); // out of the vm realm
    assert.deepEqual(held(), [60, 64]);
    const from = e.log.length;
    e.synth.send([0x99, 36, 100], 1.6); // due at 1.6 s, the audio clock at 1 s
    assert.equal(e.notes.at(-1)?.n, 36, "the drum hit plays");
    const cut = /** @type {{oscs: string[]}} */ (e.notes.find((n) => n.n === 64)).oscs;
    assert.ok(cut.every((o) => e.log.slice(from).some((c) => c[0] === o && c[1] === "stop" && c[2] === undefined)), "note 64 is cut at once");
    assert.deepEqual(held(), [60], "one melodic note is left, and no drum voice");
  });

  test("GS scale tuning survives a reload (each ▶); RPN coarse tuning does not", () => {
    // Tick 0: C4 on channel 1; tick 96: GS scale tuning of C on part 1 (channel 1), +12 cents.
    const gs = [0xf0, 0x0a, 0x41, 0x10, 0x42, 0x12, 0x40, 0x11, 0x40, 0x4c, 0x23, 0xf7];
    const midi = smf({ ppq: PPQ, tracks: [[[0, 0x90, 60, 100], [96, 0x80, 60, 0], [0, ...gs], [96, ...EOT]]] });
    const e = engine();
    e.play(midi);
    e.run(0.6); // the first note at 0.1 s, then the tuning (due at 0.6 s, scheduled from 0.4 s)
    assert.ok(near(e.synth.scaleTuning[0][0], 0.12), "the tuning was applied");
    e.synth.stopMIDI();
    e.synth.send([0xb0, 101, 0], 1); // RPN 2, coarse tuning +1 semitone: reset by the reload
    e.synth.send([0xb0, 100, 2], 1);
    e.synth.send([0xb0, 6, 65], 1);
    e.play(midi); // ▶ again: loadMIDI resets the channels
    e.run(e.ctx.currentTime + 0.1);
    const [first, second] = e.notes;
    assert.ok(near(first.freq, 440 * 2 ** (-9 / 12)), `first start: ${first.freq} Hz`);
    assert.ok(near(second.freq, 440 * 2 ** ((-9 + 0.12) / 12)), `second start: ${second.freq} Hz, C still 12 cents sharp`);
  });

  test("CC123 cuts the channel's notes when scheduled; CC121 leaves sustained notes held", () => {
    const e = engine();
    e.synth.send([0x90, 60, 100], 1);
    const [n] = e.notes;
    const from = e.log.length;
    e.synth.send([0xb0, 123, 0], 5); // due at 5 s, the audio clock at 0
    assert.ok(n.oscs.every((o) => e.log.slice(from).some((c) => c[0] === o && c[1] === "stop" && c[2] === undefined)), "stopped at once");

    e.synth.send([0xb0, 64, 127], 1);
    e.synth.send([0x90, 62, 100], 1);
    e.synth.send([0x80, 62, 0], 1.5);
    e.synth.send([0xb0, 121, 0], 2);
    const held = e.synth.notetab.find((/** @type {any} */ x) => x.n === 62);
    assert.equal(e.synth.sustain[0], 0);
    assert.equal(held.e, 99999, "CC121 turns sustain off without releasing the note");
    e.synth.send([0xb0, 64, 0], 3);
    assert.ok(held.e < 99999, "the next CC64 below 64 releases it");
  });

  test("bend range: full scale is (MSB x 128 + LSB) x 100 / 127 cents", () => {
    const e = engine();
    e.synth.send([0x90, 60, 100], 1);
    const [n] = e.notes;
    const detune = () => e.log.filter((c) => c[0] === `${n.oscs[0]}.detune` && c[1] === "set").at(-1)?.[2];
    e.synth.send([0xe0, 0, 0], 1);
    assert.ok(near(detune(), -256 * 100 / 127), `default: ${detune()} cents`);
    for (const m of [[0xb0, 101, 0], [0xb0, 100, 0], [0xb0, 6, 12], [0xb0, 38, 0], [0xe0, 0, 0]]) e.synth.send(m, 1);
    assert.ok(near(detune(), -1536 * 100 / 127), `RPN 0 = 12: ${detune()} cents`);
  });

  test("GM Master Volume SysEx, bank select and CC91 are ignored", () => {
    const e = engine();
    const from = e.log.length;
    for (const m of [[0xf0, 0x7f, 0x7f, 0x04, 0x01, 0x00, 0x20, 0xf7], [0xb0, 0, 1], [0xb0, 32, 1], [0xb0, 91, 127]]) e.synth.send(m, 1);
    assert.deepEqual(e.log.slice(from), []);
    assert.equal(e.synth.masterVol, 0.5);
  });
});
