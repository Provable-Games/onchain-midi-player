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
import { SettingsError, createSynth, decodeSettings, installSettings, toTinySynthOps } from "./settings.js";
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
  for (const f of fixtures.reserved) {
    test(`reserved ${f.name}: encodes, rejected in v1`, () => {
      assert.equal(encodeSettings(f.settings), f.settings_text);
      assert.deepEqual(decodeSettings(f.settings_text), f.settings);
      assert.deepEqual(errorOf(() => validateSettings(f.settings)), f.error);
      assert.deepEqual(errorOf(() => decodeAndValidate(f.settings_text)), f.error);
      assert.deepEqual(decodeSettings(f.settings_text), f.settings, "the page's decoder accepts it: validation is Cairo's job");
    });
  }
  for (const f of fixtures.invalid) {
    test(`invalid ${f.name}: ${f.error.join(", ")}`, () => {
      assert.deepEqual(errorOf(() => encodeSettings(validateSettings(f.settings))), f.error);
      // The text path rejects it too, with the same panic data for single-violation fixtures.
      // Counts are bounded while decoding, so with several violations a bad count can be reported
      // first (the order_* fixtures); the length cap is the encoder's alone.
      if (f.error[0] !== "TS: settings too long") {
        const text = encodeSettings(f.settings, { limit: Infinity });
        const got = errorOf(() => decodeAndValidate(text));
        if (f.name.startsWith("order_")) assert.ok(got);
        else assert.deepEqual(got, f.error);
      }
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
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,0,33")), ["TS: too many timbres"]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,17")), ["TS: too many waves"]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,1,0,0")), ["TS: harmonics length", 0]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,1,0,65")), ["TS: harmonics length", 0]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,2,1,2,0,0,1,1")), ["TS: samples length", 1]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,1,1,257")), ["TS: samples length", 0]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,0,1,0,0,9")), ["TS: too many operators", 0]);
    assert.deepEqual(errorOf(() => decodeSettings("1,1,30,40,64,0,1,0,0,4294967295")), ["TS: too many operators", 0]);
  });
});

describe("installer", () => {
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
    /** @param {number} m @param {number} n @param {any[]} p */
    setTimbre(m, n, p) {
      this.calls.push(["setTimbre", m, n, p]);
      for (const op of p) op.mutated = true; // TinySynth's filldef mutates the objects it gets
    }
  }

  test("constructs with quality, useReverb and voices, then installs in order", () => {
    const synth = createSynth(FakeSynth, beast);
    assert.deepEqual(synth.calls.map((/** @type {any[]} */ c) => c.slice(0, 3)), [
      ["new", { quality: 1, useReverb: 0, voices: 64 }],
      ["setQuality", 1], ["setMasterVol", 0.4], ["setReverbLev", 0], ["setVoices", 64],
      ["setTimbre", 0, 0], ["setTimbre", 1, 36], ["setTimbre", 1, 38],
    ]);
    const reverb = createSynth(FakeSynth, { ...beast, reverb: 30 });
    assert.deepEqual(reverb.calls[0], ["new", { quality: 1, useReverb: 1, voices: 64 }]);
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
