// @ts-check
// Installs the reference timbres, custom waves and filters into the real TinySynth (the vendored fork build,
// see scripts/engine.mjs) running on a WebAudio mock that records every scheduling call, and checks
// what the engine schedules. No audio is rendered: scripts/render_check.mjs renders real audio in a
// browser.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import vm from "node:vm";
import { createSynth, decodeSettings, installSettings, toTinySynthOps } from "../player/settings.js";
import { engineSource } from "./engine.mjs";
import { webAudioMock } from "./webaudio_mock.mjs";
import { encodeSettings } from "../player/encode.js";
import { BEAST_SETTINGS, FILTER_SETTINGS, INVALID, VALID, longLfsr, structuralMax } from "./settings_fixtures.mjs";

/** Loads the engine into a fresh context with a recording WebAudio mock. */
function loadEngine() {
  const { AudioContext, log, nodes } = webAudioMock();
  const sandbox = { AudioContext, performance: { now: () => 0 }, setInterval: () => 0, clearInterval() {}, console };
  vm.createContext(sandbox);
  vm.runInContext(engineSource(), sandbox);
  return { Synth: /** @type {any} */ (sandbox).WebAudioTinySynth, log, nodes };
}

/** The calls the engine makes for one note-on. */
function noteOn(/** @type {any} */ synth, /** @type {any[][]} */ log, /** @type {number[]} */ args) {
  const from = log.length;
  synth.noteOn(...args);
  return log.slice(from);
}

const settings = decodeSettings(encodeSettings(BEAST_SETTINGS));
const T = 1;

describe("reference timbres in the real engine", () => {
  test("lead: triangle carrier at the note's pitch, 6 Hz triangle LFO faded in over 0.2 s", () => {
    const { Synth, log, nodes } = loadEngine();
    const synth = createSynth(Synth, settings);
    const calls = noteOn(synth, log, [0, 69, 127, T]);
    const types = calls.filter((c) => c[1] === "type").map((c) => c[2]);
    assert.deepEqual(types, ["triangle", "triangle"]);
    const [carrier, lfo] = calls.filter((c) => c[1] === "create" && c[0].startsWith("osc")).map((c) => c[0]);
    assert.equal(nodes[carrier].frequency.value, 440);
    assert.equal(nodes[lfo].frequency.value, 6);
    // The LFO's output gain node is connected to the carrier's frequency.
    const fm = calls.find((c) => c[1] === "connect" && c[2] === `${carrier}.frequency`);
    assert.ok(fm, "LFO gain connects to the carrier frequency");
    const depth = calls.find((c) => c[0] === `${fm[0]}.gain` && c[1] === "ramp");
    assert.ok(depth);
    assert.ok(Math.abs(depth[2] - 0.0175 * 440) < 1e-9, `FM depth ${depth[2]} Hz`);
    assert.ok(Math.abs(depth[3] - (T + 0.2)) < 1e-9, "LFO fades in over 0.2 s");
    const carrierGain = calls.find((c) => c[1] === "ramp" && c[0] !== `${fm[0]}.gain`);
    assert.ok(carrierGain && Math.abs(carrierGain[3] - (T + 0.003)) < 1e-9, "3 ms attack");
    assert.ok(Math.abs(carrierGain[2] - 0.3 * (127 * 127) / 16384) < 1e-9, "level 0.3 x velocity^2");
  });

  test("kick: triangle from 160 Hz to 45 Hz (30 ms), noise click, note cut at 175 ms", () => {
    const { Synth, log } = loadEngine();
    const synth = createSynth(Synth, settings);
    const calls = noteOn(synth, log, [9, 36, 127, T]);
    const target = calls.find((c) => c[0].endsWith(".frequency") && c[1] === "target");
    assert.ok(target);
    assert.ok(Math.abs(target[2] - 160 * 0.2813) < 1e-9 && target[3] === T && target[4] === 0.03);
    const rate = calls.find((c) => c[0].startsWith("src") && c[1] === "create");
    assert.ok(rate, "noise operator");
    const stops = calls.filter((c) => c[1] === "stop").map((c) => c[2]);
    assert.deepEqual(stops.map((t) => Math.round((t - T) * 1e6) / 1e6), [0.175, 0.175]);
  });

  test("snare: noise at playback rate 0.6, square body from 200 Hz to 110 Hz (17 ms)", () => {
    const { Synth, log } = loadEngine();
    const synth = createSynth(Synth, settings);
    const before = log.length;
    synth.noteOn(9, 38, 127, T);
    const calls = log.slice(before);
    assert.deepEqual(calls.filter((c) => c[1] === "type").map((c) => c[2]), ["square"]);
    const target = calls.find((c) => c[0].endsWith(".frequency") && c[1] === "target");
    assert.ok(target && Math.abs(target[2] - 110) < 1e-9 && target[4] === 0.017);
    const src = synth.drummap[38 - 35].p[0];
    assert.equal(src.w, "n0");
    assert.equal(src.f / 440, 0.6);
  });

  test("a MIDI program change selects a custom program; a drum note selects a custom drum", () => {
    const { Synth, log, nodes } = loadEngine();
    const lead80 = { ...BEAST_SETTINGS.timbres[0], slot: 80 };
    const synth = createSynth(Synth, decodeSettings(encodeSettings({ ...BEAST_SETTINGS, timbres: [lead80, BEAST_SETTINGS.timbres[1]] })));
    synth.send([0xc0, 80]); // program change, channel 1
    let from = log.length;
    synth.send([0x90, 69, 100], T); // note on
    const lfo = log.slice(from).filter((c) => c[1] === "create" && c[0].startsWith("osc")).map((c) => c[0])[1];
    assert.ok(lfo && nodes[lfo].frequency.value === 6, "program 80 plays the custom lead (6 Hz LFO)");
    synth.send([0xc0, 0]); // program 0 is back to the built-in piano
    from = log.length;
    synth.send([0x90, 69, 100], T);
    assert.ok(!log.slice(from).some((c) => c[0].startsWith("osc") && c[1] === "create" && nodes[c[0]].frequency.value === 6));
    from = log.length;
    synth.send([0x99, 36, 100], T); // drum note 36, channel 10
    const target = log.slice(from).find((c) => c[0].endsWith(".frequency") && c[1] === "target");
    assert.ok(target && Math.abs(target[2] - 45.008) < 1e-9, "drum 36 plays the custom kick");
  });

  test("setQuality resets the custom timbres; installSettings restores them", () => {
    const { Synth } = loadEngine();
    const synth = createSynth(Synth, settings);
    assert.equal(synth.program[0].p.length, 2);
    assert.equal(synth.program[0].p[1].f, 6);
    synth.setQuality(1);
    assert.notEqual(synth.program[0].p[1]?.f, 6, "built-in piano is back");
    installSettings(synth, settings);
    assert.equal(synth.program[0].p[1].f, 6);
    assert.equal(synth.drummap[36 - 35].p[0].p, 0.2813);
  });

  test("reverb 0 creates no convolver; reverb 30 gives convolver gain 2.4", () => {
    const off = loadEngine();
    createSynth(off.Synth, settings);
    assert.ok(!off.log.some((c) => c[0].startsWith("conv")));
    const on = loadEngine();
    const synth = createSynth(on.Synth, { ...settings, reverb: 30 });
    assert.ok(on.log.some((c) => c[0].startsWith("conv")));
    assert.ok(Math.abs(synth.rev.gain.value - 2.4) < 1e-12);
    assert.equal(synth.out.gain.value, 0.4);
  });
});

describe("custom waves in the real engine (issue #2)", () => {
  const named = (/** @type {string} */ name) => decodeSettings(encodeSettings(/** @type {any} */ (VALID.find((f) => f.name === name)).settings));

  test("a sample wave plays as a looped buffer at the note's pitch; a harmonic wave as a PeriodicWave", () => {
    const { Synth, log, nodes } = loadEngine();
    const synth = createSynth(Synth, named("custom_waves"));
    // Harmonic waves: imag = [0, h...], real all zero (after the engine's built-in w9999).
    const waves = log.filter((c) => c[1] === "createPeriodicWave").map((c) => c[2]).slice(-2);
    assert.deepEqual(waves[0], { real: Array(12).fill(0), imag: [0, 100, 0, 55, 0, 32, 0, 18, 0, 10, 0, 6] });
    assert.deepEqual(waves[1], { real: [0, 0], imag: [0, 65535] });
    synth.send([0xc0, 80]); // program 80: nS1 carrier, FM from wH0
    const calls = noteOn(synth, log, [0, 69, 127, T]);
    const src = calls.find((c) => c[0].startsWith("src") && c[1] === "create");
    assert.ok(src, "the sample wave plays from a buffer");
    // 16 samples at the mock's 8 kHz: each held k = max(1, round(8000 / (440 x 16))) = 1 frame, home
    // pitch 8000 / 16 = 500 Hz, so A4 plays at rate 440 / 500, looping the 16 frames before the guard.
    const node = nodes[src[0]];
    assert.equal(node.playbackRate.value, 440 / 500);
    assert.equal(node.loop, true);
    assert.equal(node.loopEnd, 16 / 8000);
    assert.equal(node.buffer.length, 17);
    assert.deepEqual(Array.from(node.buffer.getChannelData(0).slice(0, 4)), [-1, -0.75, -0.5, -0.25]);
    const osc = calls.find((c) => c[1] === "periodicWave");
    assert.ok(osc && osc[2] === waves[0], "the modulator plays wH0");
  });

  test("the waves survive setQuality; installSettings restores the timbres that name them", () => {
    const { Synth, log, nodes } = loadEngine();
    const s = named("reference_waves");
    const synth = createSynth(Synth, s);
    synth.setQuality(0);
    assert.notEqual(synth.program[0].p[0].w, "nS0", "setQuality reinstalls the built-in timbres");
    synth.setQuality(1);
    installSettings(synth, s);
    const calls = noteOn(synth, log, [0, 69, 127, T]);
    const src = calls.find((c) => c[0].startsWith("src") && c[1] === "create");
    assert.ok(src, "program 0 plays the stepped triangle again");
    // 64 samples at 8 kHz: k = 1, home pitch 8000 / 64 = 125 Hz.
    assert.equal(nodes[src[0]].playbackRate.value, 440 / 125);
  });

  test("every valid settings fixture installs in the real engine, as converted: T5's setTimbre rejects none", () => {
    // The engine (fork T5) validates every timbre before installing it and throws on an unknown wave,
    // a bad route, a non-finite value or a filter it does not take; it stores a copy. Whatever
    // settings::validate accepts must install unchanged: every fixture (the filters at their extremes
    // included), the long LFSR, the largest input without custom waves, and every operator and filter
    // field at its type's extremes (the engine's setTimbre takes the whole type; when it plays, it
    // skips a note whose computed values overflow float32).
    const u = 4294967295;
    const fields = (/** @type {number} */ i32) => [u, u, i32, u, u, u, u, u, u, u, i32].join(",");
    const extremes = `1,1,255,255,255,0,2,0,0,1,0,2,${fields(2147483647)},1,2,${u},1,${u},1,35,1,0,4,${fields(-2147483648)},1,0,1,0,1`;
    const cases = [...VALID.map((f) => [f.name, encodeSettings(f.settings)]), ["long_lfsr", encodeSettings(longLfsr())],
      ["structural_max", encodeSettings(structuralMax())], ["type extremes", extremes]];
    for (const [name, text] of cases) {
      const { Synth } = loadEngine();
      const s = decodeSettings(text);
      const synth = createSynth(Synth, s);
      for (const t of s.timbres) {
        const installed = (t.drum ? synth.drummap[t.slot - 35] : synth.program[t.slot]).p;
        assert.equal(JSON.stringify(installed), JSON.stringify(toTinySynthOps(t, s.waves)), `${name}: ${t.drum ? "drum" : "program"} ${t.slot}`);
      }
    }
  });

  test("256 waves, long tables and an all-zero harmonic wave register; the last wave plays", () => {
    const builtIn = loadEngine();
    createSynth(builtIn.Synth, named("default"));
    const { Synth, log } = loadEngine();
    const synth = createSynth(Synth, named("waves_256"));
    const count = (/** @type {any[][]} */ l) => l.filter((c) => c[1] === "createPeriodicWave").length;
    assert.equal(count(log) - count(builtIn.log), 254, "254 harmonic waves");
    const calls = noteOn(synth, log, [0, 60, 127, T]);
    assert.equal(calls.filter((c) => c[0].startsWith("src") && c[1] === "create").length, 1, "nS255");
    assert.equal(calls.filter((c) => c[1] === "periodicWave").length, 1, "wH252 (all zero: silent)");
  });
});

describe("filters in the real engine (issue #3)", () => {
  const filters = decodeSettings(encodeSettings(FILTER_SETTINGS));
  /** The filter nodes one note creates, as [node, type, frequency, Q], and the calls it makes. */
  function filtersOf(/** @type {any} */ synth, /** @type {any[][]} */ log, /** @type {Record<string, any>} */ nodes, /** @type {number[]} */ args) {
    const calls = noteOn(synth, log, args);
    const made = calls.filter((c) => c[0].startsWith("biquad") && c[1] === "create").map((c) => nodes[c[0]]);
    return { calls, made: made.map((b) => [b.name, b.kind, b.frequency.value, b.Q.value]) };
  }

  test("a filtered output plays through a biquad of its kind, cutoff and Q, between its envelope and the channel", () => {
    const { Synth, log, nodes } = loadEngine();
    const synth = createSynth(Synth, filters);
    const dB = (/** @type {number} */ q) => 20 * Math.log10(q);
    const cases = /** @type {Array<[number, string, number, number]>} */ ([[0, "lowpass", 1000, dB(0.7071)], [1, "highpass", 1000, dB(0.7071)], [2, "bandpass", 1000, 4]]);
    for (const [program, type, hz, q] of cases) {
      synth.setProgram(0, program);
      const { calls, made } = filtersOf(synth, log, nodes, [0, 45, 127, T]);
      assert.equal(made.length, 1, `program ${program}: one filter`);
      const [name, kind, f, Q] = made[0];
      assert.deepEqual([kind, f], [type, hz]);
      assert.ok(Math.abs(Q - q) < 1e-12, `Q ${Q}: linear for band-pass, 20 log10(q) dB for low- and high-pass`);
      // oscillator -> gain (the envelope) -> filter -> channel volume
      const gain = calls.find((c) => c[1] === "connect" && c[2] === name)?.[0];
      assert.ok(gain?.startsWith("gain"), "the operator's gain feeds the filter");
      assert.deepEqual(calls.filter((c) => c[0] === name && c[1] === "connect").map((c) => c[2]), [synth.chvol[0].name]);
    }
  });

  test("key_track: the cutoff is the multiple times the note's frequency, clamped to 0.45 x the sample rate", () => {
    const { Synth, log, nodes } = loadEngine();
    const synth = createSynth(Synth, filters);
    synth.setProgram(0, 3); // low-pass at 4x the note frequency
    assert.equal(filtersOf(synth, log, nodes, [0, 45, 127, T]).made[0][2], 4 * 110);
    assert.equal(filtersOf(synth, log, nodes, [0, 69, 127, T]).made[0][2], 4 * 440);
    // The mock runs at 8 kHz: 0.45 x 8000 = 3600 Hz, reached from note 75 (4 x 622 Hz).
    assert.equal(filtersOf(synth, log, nodes, [0, 127, 127, T]).made[0][2], 3600);
    // A fixed cutoff stays put: the hat's 3 kHz.
    assert.equal(filtersOf(synth, log, nodes, [9, 42, 127, T]).made[0][2], 3000);
  });

  test("operators without a filter get no filter node, so the graph is as before; FM and AM paths are never filtered", () => {
    const { Synth, log, nodes } = loadEngine();
    const beast = createSynth(Synth, settings);
    for (const args of [[0, 69, 127, T], [9, 36, 127, T], [9, 38, 127, T]]) assert.deepEqual(filtersOf(beast, log, nodes, args).made, []);
    const named = /** @type {any} */ (VALID.find((f) => f.name === "one_filter")).settings;
    const synth = createSynth(Synth, decodeSettings(encodeSettings(named)));
    const { calls, made } = filtersOf(synth, log, nodes, [0, 69, 127, T]);
    assert.deepEqual(made.map((m) => [m[1], m[2]]), [["lowpass", 1760]], "the carrier only");
    const [carrier] = calls.filter((c) => c[1] === "create" && c[0].startsWith("osc")).map((c) => c[0]);
    assert.ok(calls.some((c) => c[1] === "connect" && c[2] === `${carrier}.frequency`), "the LFO still modulates the carrier directly");
  });

  test("the engine rejects every filter settings::validate rejects, and the filter is released with the voice", () => {
    // Validation bypassed: T5's setTimbre throws on a filter on a modulator and on a cutoff or Q of 0,
    // the shapes checks 20-22 reject (the engine's own rules, mirrored).
    const rejected = INVALID.filter((f) => f.error[0].startsWith("TS: filter"));
    assert.ok(rejected.length >= 5);
    for (const f of rejected) {
      const { Synth } = loadEngine();
      assert.throws(() => createSynth(Synth, decodeSettings(encodeSettings(f.settings))), /fl on a modulator|ff: 0|fq: 0/, f.name);
    }
    const { Synth, log, nodes } = loadEngine();
    const synth = createSynth(Synth, filters);
    const { made } = filtersOf(synth, log, nodes, [0, 69, 127, T]);
    synth.noteOff(0, 69, T + 0.5);
    synth.allSoundOff(0);
    for (const n of Object.values(nodes)) if (n.name.startsWith("osc") || n.name.startsWith("src")) n.onended?.();
    assert.ok(log.some((c) => c[0] === made[0][0] && c[1] === "disconnect"), "the filter is disconnected once its oscillator ends");
  });
});
