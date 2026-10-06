// Hand-calculated input-only controls for the independent certification oracle.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { analyzeMidi, equalTemperamentHz } from "./oracle.mjs";
import {
  BEND_RANGE_MIDI, CC121_MIDI, EXTREME_KEY_MIDI, EXTREME_SETTINGS, FORMAT1_OFF_BEFORE_ON_MIDI, FORMAT1_ON_BEFORE_OFF_MIDI,
  HELD_SAMPLE_BEND_MIDI,
  GOOD_MIDI, INITIALIZED_MASTER_COARSE_TUNING_MIDI, LATE_MASTER_COARSE_TUNING_MIDI, LONG_SUSTAIN_MIDI,
  LONG_TAIL_SETTINGS, SAMPLE_BEND_SETTINGS, SECONDARY_TAIL_SETTINGS, SHORT_LOOP_LONG_TAIL_MIDI, SIMPLE_SETTINGS, ZERO_LENGTH_MIDI,
} from "./fixtures.mjs";

const analyze = (midi, settings = SIMPLE_SETTINGS, extra = {}) => analyzeMidi(midi, settings, {
  horizonSeconds: 0.2, startupAnchorSeconds: 0.1, schedulerIntervalSeconds: 0.06,
  sampleRate: 44100, releaseRatio: 3.5, eotHeldNotes: "reject", ...extra,
});
const codes = (report) => new Set(report.failures.map((item) => item.code));
const incompleteCodes = (report) => new Set(report.incomplete.map((item) => item.code));

describe("independent certification intent/state oracle", () => {
  test("a hand-counted three-pass sine score yields C4 and C5 at equal temperament", () => {
    const report = analyze(GOOD_MIDI);
    assert.equal(report.notes.filter((note) => note.pass < 3).length, 9);
    assert.ok(report.demand.resourcePasses > 3);
    assert.equal(report.openingNotes.length, 3);
    assert.equal(report.openingNotes[0].expectedFundamentalHz, equalTemperamentHz(60));
    assert.equal(report.notes[2].expectedFundamentalHz, equalTemperamentHz(72));
    assert.equal(report.failures.length, 0, JSON.stringify(report.failures));
    assert.equal(report.incomplete.length, 0, JSON.stringify(report.incomplete));
    assert.equal(report.notes[0].expectedOperators[0].frequencyHz, equalTemperamentHz(60));
  });

  test("late master coarse tuning fails tick-zero initialization and catches octave drift despite note counts", () => {
    const report = analyze(LATE_MASTER_COARSE_TUNING_MIDI);
    assert.ok(codes(report).has("missing-tick-zero-state"));
    assert.ok(codes(report).has("opening-state-drift"));
    assert.equal(report.notes.filter((note) => note.pass === 0).length, report.notes.filter((note) => note.pass === 1).length);
    assert.equal(report.openingNotes[0].expectedFundamentalHz, equalTemperamentHz(60));
    assert.equal(report.openingNotes[1].expectedFundamentalHz, equalTemperamentHz(72));
  });

  test("master coarse tuning set before tick zero is accepted and independently changes C4 to C5", () => {
    const report = analyze(INITIALIZED_MASTER_COARSE_TUNING_MIDI);
    assert.equal(report.openingNotes[0].expectedFundamentalHz, equalTemperamentHz(72));
    assert.deepEqual(report.failures, []);
    assert.deepEqual(report.incomplete, []);
  });

  test("RPN 0 bend uses normative semitone+cents intent and reports the pinned engine arithmetic separately", () => {
    const report = analyze(BEND_RANGE_MIDI);
    const note = report.notes[0];
    const operator = note.expectedOperators[0];
    assert.equal(note.state.bendRangeSemitones, 2);
    assert.equal(note.state.bendRangeCents, 0);
    assert.equal(operator.detuneCents, -200);
    assert.ok(Math.abs(operator.legacyEngineDetuneCents - -201.5748031496063) < 1e-12);
    assert.equal(note.expectedFundamentalHz, equalTemperamentHz(60) * 2 ** (-200 / 1200));
    assert.ok(incompleteCodes(report).has("rpn-bend-range-unqualified"));
    assert.ok(incompleteCodes(report).has("nonzero-pitch-bend-unqualified"));
    assert.equal(report.status, "incomplete", "the independent oracle must not bless the legacy /127 mismatch");
  });

  test("a later bend of a held custom sample is a known unsupported engine path", () => {
    const report = analyze(HELD_SAMPLE_BEND_MIDI, SAMPLE_BEND_SETTINGS, { waveIntents: { 0: "pitched" } });
    assert.equal(report.notes[0].expectedOperators[0].source, "sample");
    assert.ok(codes(report).has("held-sample-bend-unsupported"));
  });

  test("operator release tails use the measured configured release ratio", () => {
    const report = analyze(GOOD_MIDI, SIMPLE_SETTINGS, { releaseRatio: 2 });
    assert.equal(report.notes[0].expectedOperators[0].releaseTailSeconds, 0.02);
    assert.equal(report.demand.maxExpectedTailSeconds, 0.02);
  });

  test("format-1 merged ordering rejects on-before-existing-off across tracks", () => {
    const report = analyze(FORMAT1_ON_BEFORE_OFF_MIDI);
    assert.equal(report.format, 1);
    assert.ok(codes(report).has("same-tick-retrigger-order"));
  });

  test("format-1 off-before-on closes the prior instance before retriggering", () => {
    const report = analyze(FORMAT1_OFF_BEFORE_ON_MIDI);
    assert.equal(report.format, 1);
    assert.equal(report.notes[0].offTick, 48);
    assert.equal(report.notes[1].tick, 48);
    assert.ok(!codes(report).has("same-tick-retrigger-order"));
    assert.ok(!incompleteCodes(report).has("overlapping-same-key"));
  });

  test("a note's own zero-length on/off pair is represented without masquerading as retrigger order", () => {
    const report = analyze(ZERO_LENGTH_MIDI);
    assert.equal(report.notes[0].zeroLength, true);
    assert.ok(!codes(report).has("same-tick-retrigger-order"));
  });

  test("a valid-range extreme key-scale patch is rejected when MIDI 127 overflows finite float32", () => {
    const report = analyze(EXTREME_KEY_MIDI, EXTREME_SETTINGS);
    assert.ok(codes(report).has("numeric-source-out-of-range"));
  });

  test("long sustain remains allocated until pedal-up, not key-off", () => {
    const report = analyze(LONG_SUSTAIN_MIDI);
    assert.equal(report.notes[0].offTime, 0.5);
    assert.ok(report.notes[0].allocatorExpectedEnd > 0.5);
  });

  test("50 ms loop demand covers the horizon and long release tail beyond three passes", () => {
    const report = analyze(SHORT_LOOP_LONG_TAIL_MIDI, LONG_TAIL_SETTINGS, { horizonSeconds: 0.5 });
    assert.equal(report.loopSeconds, 0.05);
    assert.ok(report.demand.resourcePasses > 3);
    assert.ok(report.demand.allocatorMelodicVoices.maximum > 16);
    assert.ok(codes(report).has("voice-demand-exceeds-budget"));
  });

  test("secondary operator tail is independently reported against the legacy operator-0 allocator lifetime", () => {
    const report = analyze(GOOD_MIDI, SECONDARY_TAIL_SETTINGS);
    assert.ok(report.demand.secondaryTailMismatches > 0);
    assert.ok(codes(report).has("operator-tail-exceeds-allocator"));
    assert.ok(report.demand.uncappedOperatorSources.maximum > report.demand.allocatorMelodicVoices.maximum);
  });

  test("missing or NaN timing input returns incomplete under a child-process deadline", () => {
    const code = `import { analyzeMidi } from './scripts/certification/oracle.mjs'; import { GOOD_MIDI, SIMPLE_SETTINGS } from './scripts/certification/fixtures.mjs'; const r = analyzeMidi(GOOD_MIDI,SIMPLE_SETTINGS,{horizonSeconds:NaN,startupAnchorSeconds:.1,schedulerIntervalSeconds:.06,sampleRate:44100,releaseRatio:3.5,eotHeldNotes:'reject'}); console.log(r.status, r.incomplete.map(x=>x.code).join(','));`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: process.cwd(), encoding: "utf8", timeout: 3000 });
    assert.equal(child.error, undefined, String(child.error));
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /^incomplete invalid-runtime-timing/m);
  });

  test("CC121 is rejected as a forbidden 120-127 controller", () => {
    assert.ok(codes(analyze(CC121_MIDI)).has("forbidden-controller"));
  });
});
