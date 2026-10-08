// @ts-check
// Node tests for player/settings.js (the page's strict decoder and TinySynth installer),
// player/validate.js and player/encode.js (the JS reference of src/settings.cairo): parity with the
// shared fixtures (which the Cairo tests assert too), the decoder's strictness, and the installer.
//
// Run: node --test "player/**/*.test.js" "scripts/**/*.test.mjs"   (or npm test)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { encodeSettings } from "./encode.js";
import { SettingsError, createSynth, decodeSettings, installSettings, registerWaves, toTinySynthOps, waveName } from "./settings.js";
import { validateSettings } from "./validate.js";

/** Cairo's validate then the page's decoder, as text: the reference's full check of SETTINGS. */
const decodeAndValidate = (/** @type {string} */ text) => validateSettings(decodeSettings(text));

const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/settings.json", import.meta.url), "utf8"));

/** @param {() => unknown} fn */
function errorOf(fn) {
  try {
    fn();
  } catch (e) {
    if (e instanceof SettingsError) return [e.code, ...e.indices];
    throw e;
  }
  return null;
}

describe("shared fixtures", () => {
  for (const f of fixtures.valid) {
    test(`valid ${f.name} (${f.bytes} bytes)`, () => {
      assert.equal(errorOf(() => validateSettings(f.settings)), null);
      assert.equal(encodeSettings(f.settings), f.settings_text);
      assert.deepEqual(decodeSettings(f.settings_text), f.settings);
      assert.deepEqual(decodeAndValidate(f.settings_text), f.settings);
      assert.match(f.settings_text, /^[0-9,-]+$/);
    });
  }
  for (const f of fixtures.invalid) {
    test(`invalid ${f.name}: ${f.error.join(", ")}`, () => {
      assert.deepEqual(errorOf(() => encodeSettings(validateSettings(f.settings))), f.error);
      // The text path rejects it too, with the same panic data for single-violation fixtures.
      // Counts are bounded while decoding, so with several violations a bad count can be reported
      // first (the order_* fixtures).
      const got = errorOf(() => decodeAndValidate(encodeSettings(f.settings)));
      if (f.name.startsWith("order_")) assert.ok(got);
      else assert.deepEqual(got, f.error);
    });
  }
});

describe("decoder strictness", () => {
  const ok = fixtures.valid.find((/** @type {any} */ f) => f.name === "beast_reference").settings_text;
  const malformed = (/** @type {string} */ text) => assert.deepEqual(errorOf(() => decodeSettings(text)), ["malformed"]);

  test("accepts the page's alignment padding (leading and trailing U+0020 only)", () => {
    assert.ok(decodeSettings("        " + ok + "  "));
    malformed("\t" + ok);
    malformed(ok + "\n");
    malformed(" " + ok);
  });
  test("rejects non-canonical integers", () => {
    for (const bad of ["01", "+1", "-0", "1.0", "1e3", "0x10", "", " 1", "1 ", "--1", "١"]) {
      malformed(`1,1,30,40,64,0,${bad}`);
    }
    malformed("1,01,30,40,64,0,0");
  });
  test("rejects other characters, including <", () => {
    malformed("1,1,30,40,64,0,0<");
    malformed("1;1;30;40;64;0;0");
    malformed("");
  });
  test("rejects other format versions", () => {
    malformed("2,1,30,40,64,0,0");
    malformed("0,1,30,40,64,0,0");
  });
  test("requires every token to be consumed, and no more", () => {
    malformed("1,1,30,40,64,0,0,0");
    malformed("1,1,30,40,64,0");
    malformed(ok + ",0");
    malformed(ok.slice(0, ok.lastIndexOf(",")));
  });
  test("rejects values outside their Cairo type", () => {
    malformed("1,256,30,40,64,0,0");
    malformed("1,-1,30,40,64,0,0");
    malformed("1,1,30,40,64,1,0,1,65536,0");
    malformed("1,1,30,40,64,1,1,2,0,-129,0");
    const op = (/** @type {string} */ fields) => `1,1,30,40,64,0,1,0,0,1,${fields}`;
    assert.ok(decodeSettings(op("0,0,5000,10000,0,0,100,100,0,500,10000,10000,0,0")));
    malformed(op("0,0,4294967296,10000,0,0,100,100,0,500,10000,10000,0,0"));
    malformed(op("0,0,5000,10000,2147483648,0,100,100,0,500,10000,10000,0,0"));
    malformed(op("0,0,-1,10000,0,0,100,100,0,500,10000,10000,0,0"));
    malformed(op("0,0,5000,10000,0,0,100,100,0,500,10000,10000,0,2"));
    malformed("1,1,30,40,64,0,1,2,0,0");
  });
  test("rejects unknown tags", () => {
    const op = (/** @type {string} */ wave, /** @type {string} */ filter) =>
      `1,1,30,40,64,0,1,0,0,1,0,${wave},5000,10000,0,0,100,100,0,500,10000,10000,0,${filter}`;
    assert.ok(decodeSettings(op("5", "0")));
    malformed(op("7", "0"));
    malformed(op("6,256", "0"));
    malformed(op("0", "1,3,1,0,1"));
    malformed("1,1,30,40,64,1,2,1,0,0");
  });
  test("bounds counts before reading their items", () => {
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,0,176")), ["TS: too many timbres"]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,0,4294967295")), ["TS: too many timbres"]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,257")), ["TS: too many waves"]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,4294967295")), ["TS: too many waves"]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,1,0,0")), ["TS: harmonics length", 0]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,2,1,2,0,0,1,0")), ["TS: samples length", 1]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,0,1,0,0,9")), ["TS: too many operators", 0]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,0,1,0,0,4294967295")), ["TS: too many operators", 0]);
  });
  test("accepts every count at its bound: 175 timbres, 256 waves; wave lengths have none", () => {
    const timbre = (/** @type {number} */ i) => `0,${i},1,0,0,5000,10000,0,0,100,100,0,500,10000,10000,0,0`;
    // The parser does not check slots (Cairo does): 175 entries are within its bound whatever they hold.
    const timbres = Array.from({ length: 175 }, (_, i) => timbre(i % 128)).join(",");
    assert.equal(decodeSettings(`1,1,30,40,64,0,175,${timbres}`).timbres.length, 175);
    malformed(`1,1,30,40,64,0,175,${timbres},${timbre(0)}`);
    assert.deepEqual(errorOf(() => decodeSettings(`1,1,30,40,64,0,176,${timbres},${timbre(0)}`)), ["TS: too many timbres"]);
    // TinyChip's 32,767-step noise table, and a long harmonic series.
    const noise = Array.from({ length: 32767 }, (_, i) => (i % 3 ? 127 : -128));
    const waves = [
      ...Array(253).fill("1,1,0"),
      `0,1000,${Array(1000).fill(65535).join(",")}`,
      `1,32767,${noise.join(",")}`,
      "0,1,1",
    ].join(",");
    const s = decodeSettings(`1,1,30,40,64,256,${waves},0`);
    assert.equal(s.waves.length, 256);
    assert.deepEqual(s.waves[0], { Samples: [0] });
    assert.deepEqual(s.waves[253], { Harmonics: Array(1000).fill(65535) });
    assert.deepEqual(s.waves[254], { Samples: noise });
    // A count one short leaves a token over.
    malformed(`1,1,30,40,64,255,${waves},0`);
  });
  test("encodes and decodes a wave table of a million samples (no argument-limit spread)", () => {
    const samples = Array.from({ length: 1000000 }, (_, i) => (i % 2 ? 127 : -128));
    const s = { quality: 1, reverb: 30, master_vol: 40, voices: 64, waves: [{ Samples: samples }, { Harmonics: samples.map((x) => x + 128) }], timbres: [] };
    const text = encodeSettings(s);
    assert.ok(text.startsWith("1,1,30,40,64,2,1,1000000,-128,127,") && text.length > 7000000);
    const back = decodeSettings(text);
    assert.equal(/** @type {{Samples: number[]}} */ (back.waves[0]).Samples.length, 1000000);
    assert.deepEqual(back, s);
  });
  test("a count larger than the tokens left fails at once, before reading or allocating its items", () => {
    // Wave lengths have no bound, so only the input bounds them. The error names the token after
    // the count: no item was read.
    /** @type {Array<[string, number]>} */
    const cases = [
      ["1,1,30,40,64,1,0,4294967295,1", 8],
      ["1,1,30,40,64,1,1,4294967295,0", 8],
      ["1,1,30,40,64,1,1,3,0,0", 8],
      [`1,1,30,40,64,1,1,100000,${Array(99999).fill(0).join(",")}`, 8],
      ["1,1,30,40,64,256,0,1,1", 6],
      ["1,1,30,40,64,0,175,0,0,1", 7],
      ["1,1,30,40,64,0,1,0,0,8,0,0,5000", 10],
    ];
    for (const [text, token] of cases) {
      assert.throws(() => decodeSettings(text), { name: "SettingsError", code: "malformed", message: `settings: malformed: token ${token}` });
    }
    // The check is against the tokens left, so a count that fits still parses.
    assert.deepEqual(decodeSettings("1,1,30,40,64,1,1,3,0,0,0,0").waves, [{ Samples: [0, 0, 0] }]);
  });
});

describe("installer", () => {
  const malformedText = (/** @type {string} */ text) => assert.deepEqual(errorOf(() => decodeSettings(text)), ["malformed"]);
  const beast = fixtures.valid.find((/** @type {any} */ f) => f.name === "beast_reference").settings;

  /** A stand-in for TinySynth that records the calls the installer makes. */
  class FakeSynth {
    /** @param {any} opts */
    constructor(opts) {
      /** @type {any[]} */
      this.calls = [["new", opts]];
    }
    /** @param {number} q */
    setQuality(q) { this.calls.push(["setQuality", q]); }
    /** @param {number} v */
    setMasterVol(v) { this.calls.push(["setMasterVol", v]); }
    /** @param {number} v */
    setReverbLev(v) { this.calls.push(["setReverbLev", v]); }
    /** @param {number} v */
    setVoices(v) { this.calls.push(["setVoices", v]); }
    /** @param {string} name @param {number[]} samples */
    setSampleWave(name, samples) { this.calls.push(["setSampleWave", name, samples]); }
    /** @param {string} name @param {number[]} real @param {number[]} imag */
    setHarmonicWave(name, real, imag) { this.calls.push(["setHarmonicWave", name, real, imag]); }
    /** @param {number} m @param {number} n @param {any[]} p */
    setTimbre(m, n, p) {
      this.calls.push(["setTimbre", m, n, p]);
      for (const op of p) op.mutated = true; // TinySynth's filldef mutates the objects it gets
    }
  }

  test("constructs with quality, useReverb and voices, then installs in order", () => {
    const synth = createSynth(FakeSynth, beast);
    assert.deepEqual(synth.calls.map((/** @type {any[]} */ c) => c.slice(0, 3)), [
      ["new", { autoResume: false, quality: 1, useReverb: 0, voices: 64 }],
      ["setQuality", 1], ["setMasterVol", 0.4], ["setReverbLev", 0], ["setVoices", 64],
      ["setTimbre", 0, 0], ["setTimbre", 1, 36], ["setTimbre", 1, 38],
    ]);
    const reverb = createSynth(FakeSynth, { ...beast, reverb: 30 });
    assert.deepEqual(reverb.calls[0], ["new", { autoResume: false, quality: 1, useReverb: 1, voices: 64 }]);
    assert.deepEqual(reverb.calls[3], ["setReverbLev", 0.3]);
  });

  test("converts fixed-point values exactly", () => {
    const [lead, kick] = beast.timbres;
    assert.deepEqual(toTinySynthOps(lead), [
      { g: 0, w: "triangle", v: 0.3, t: 1, f: 0, a: 0.003, h: 0, d: 0.01, s: 1, r: 0.01, p: 1, q: 1, k: 0 },
      { g: 1, w: "triangle", v: 0.0175, t: 0, f: 6, a: 0.2, h: 0, d: 0.01, s: 1, r: 0.01, p: 1, q: 1, k: 0 },
    ]);
    const [body, click] = toTinySynthOps(kick);
    assert.equal(body.f, 160);
    assert.equal(body.p, 0.2813);
    assert.equal(click.w, "n0");
    assert.equal(click.f, 440);
    assert.equal(toTinySynthOps({ drum: false, slot: 0, operators: [{ ...lead.operators[0], key_scale: -12000, offset_hz: -20000 }] })[0].k, -1.2);
  });

  test("handles every field at its type's extremes: u32 max, i32 min and max", () => {
    // The class checks no range on these fields, so the parser and the conversion must take their
    // whole type. (Whether the engine plays such values is the engine's: see the fixtures' note.)
    const u = 4294967295;
    const fields = (/** @type {number} */ i32) => [u, u, i32, u, u, u, u, u, u, u, i32].join(",");
    const text = `1,1,255,255,255,0,2,0,0,1,0,2,${fields(2147483647)},0,1,35,1,0,4,${fields(-2147483648)},0`;
    const s = decodeSettings(text);
    assert.equal(encodeSettings(s), text);
    const [hi] = toTinySynthOps(s.timbres[0]);
    assert.deepEqual(hi, {
      g: 0, w: "sawtooth", v: 429496.7295, t: 429496.7295, f: 214748.3647, a: 429496.7295, h: 429496.7295,
      d: 429496.7295, s: 429496.7295, r: 429496.7295, p: 429496.7295, q: 429496.7295, k: 214748.3647,
    });
    const [lo] = toTinySynthOps(s.timbres[1]);
    assert.equal(lo.f, -214748.3648);
    assert.equal(lo.k, -214748.3648);
    for (const o of [hi, lo]) for (const v of Object.values(o)) if (typeof v === "number") assert.ok(Number.isFinite(v));
    const synth = createSynth(FakeSynth, s);
    assert.deepEqual(synth.calls.slice(0, 5), [
      ["new", { autoResume: false, quality: 1, useReverb: 1, voices: 255 }],
      ["setQuality", 1], ["setMasterVol", 2.55], ["setReverbLev", 2.55], ["setVoices", 255],
    ]);
    // One past each type's extreme is malformed, not accepted.
    malformedText(text.replace("4294967295", "4294967296"));
    malformedText(text.replace("2147483647", "2147483648"));
    malformedText(text.replace("-2147483648", "-2147483649"));
    malformedText(text.replace(/^1,1,255/, "1,1,256"));
  });

  test("filters: fl, ff, fq and fk from the kind, the fixed-point cutoff and Q, and key_track; none without a filter", () => {
    const s = fixtures.valid.find((/** @type {any} */ f) => f.name === "filters").settings;
    const ops = s.timbres.map((/** @type {any} */ t) => toTinySynthOps(t)[0]);
    assert.deepEqual(ops.map((/** @type {any} */ o) => [o.fl, o.ff, o.fq, o.fk]), [
      ["lowpass", 1000, 0.7071, 0], ["highpass", 1000, 0.7071, 0], ["bandpass", 1000, 4, 0], ["lowpass", 4, 0.7071, 1],
      ["highpass", 3000, 0.7071, 0], ["highpass", 3000, 0.7071, 0],
    ]);
    assert.deepEqual(Object.keys(ops[0]), ["g", "w", "v", "t", "f", "a", "h", "d", "s", "r", "p", "q", "k", "fl", "ff", "fq", "fk"]);
    // Extremes: the smallest non-zero value (0.0001, far above the engine's 2^-126) and the u32 maximum.
    const ext = fixtures.valid.find((/** @type {any} */ f) => f.name === "filter_extremes").settings;
    const all = ext.timbres.flatMap((/** @type {any} */ t) => toTinySynthOps(t)).filter((/** @type {any} */ o) => o.fl);
    assert.deepEqual([...new Set(all.flatMap((/** @type {any} */ o) => [o.ff, o.fq]))].sort((a, b) => a - b), [0.0001, 429496.7295]);
    // Without a filter, the operator has exactly the 13 keys it had before filters were accepted.
    for (const t of beast.timbres) for (const o of toTinySynthOps(t)) assert.equal(Object.keys(o).join(), "g,w,v,t,f,a,h,d,s,r,p,q,k");
  });

  test("custom waves: each registered under its index's name, before the quality and the timbres; Custom(i) names it", () => {
    const s = fixtures.valid.find((/** @type {any} */ f) => f.name === "custom_waves").settings;
    const synth = createSynth(FakeSynth, s);
    const harmonics = [100, 0, 55, 0, 32, 0, 18, 0, 10, 0, 6];
    const samples = [-128, -96, -64, -32, 0, 32, 64, 96, 127, 96, 64, 32, 0, -32, -64, -96];
    assert.deepEqual(synth.calls.slice(1, 6), [
      ["setHarmonicWave", "wH0", Array(12).fill(0), [0, ...harmonics]],
      ["setSampleWave", "nS1", samples.map((v) => v / 128)],
      ["setHarmonicWave", "wH2", [0, 0], [0, 65535]],
      ["setSampleWave", "nS3", [0.9921875, -1]],
      ["setQuality", 1],
    ]);
    const timbre = synth.calls.find((/** @type {any[]} */ c) => c[0] === "setTimbre");
    assert.deepEqual([timbre[1], timbre[2], timbre[3].map((/** @type {any} */ o) => [o.g, o.w])], [0, 80, [[0, "nS1"], [1, "wH0"]]]);
    // i8 / 128, exactly: -128 is -1, 0 is 0, 127 is 0.9921875.
    assert.deepEqual(synth.calls[2][2].slice(0, 5), [-1, -0.75, -0.5, -0.25, 0]);
    assert.equal(synth.calls[2][2][8], 127 / 128);
  });

  test("custom wave names follow the engine's grammar for every index, sample and harmonic", () => {
    // Fork #26 (D-006, D-028): n (sample) or w (harmonic), a letter or _, then up to 30 more; a digit
    // second is reserved for built-ins (n0, n1, w9999).
    for (let i = 0; i < 256; i++) {
      for (const [w, prefix] of /** @type {Array<[any, string]>} */ ([[{ Samples: [0] }, "n"], [{ Harmonics: [1] }, "w"]])) {
        const name = waveName(w, i);
        assert.match(name, /^[wn][A-Za-z_][A-Za-z0-9_]{0,30}$/);
        assert.equal(name[0], prefix);
      }
    }
    assert.deepEqual([waveName({ Samples: [0] }, 255), waveName({ Harmonics: [1] }, 0)], ["nS255", "wH0"]);
  });

  test("registerWaves: long tables and all-zero harmonics are passed as they are", () => {
    const synth = new FakeSynth({});
    const long = Array.from({ length: 40000 }, (_, i) => (i % 2 ? 127 : -128));
    registerWaves(synth, [{ Samples: long }, { Harmonics: [0, 0, 0] }]);
    assert.equal(synth.calls[1][2].length, 40000);
    assert.deepEqual(synth.calls[2], ["setHarmonicWave", "wH1", [0, 0, 0, 0], [0, 0, 0, 0]]);
  });

  test("is idempotent and passes fresh operator objects every time", () => {
    const synth = new FakeSynth({});
    installSettings(synth, beast);
    installSettings(synth, beast);
    const timbres = synth.calls.filter((/** @type {any[]} */ c) => c[0] === "setTimbre");
    assert.equal(timbres.length, 6);
    assert.notEqual(timbres[0][3][0], timbres[3][3][0]);
    assert.equal(timbres[3][3][0].mutated, true);
    assert.deepEqual({ ...timbres[3][3][0], mutated: undefined }, { ...toTinySynthOps(beast.timbres[0])[0], mutated: undefined });
  });

});
