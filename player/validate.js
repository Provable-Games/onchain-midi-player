// @ts-check
/**
 * JS reference of Cairo's `settings::validate` (src/settings.cairo), for Node and tooling only: the
 * fixture generators, the reference encoder's callers and the parity tests. It is not part of the
 * page: range and semantic validation is the class's job, and the page only parses SETTINGS
 * strictly (`decodeSettings` in player/settings.js).
 *
 * Mirrors the Cairo checks one for one, in the same order and with the same messages and indices;
 * the shared fixtures (tests/fixtures/settings.json) assert it on both sides.
 */
import {
  MAX_HARMONICS, MAX_OPERATORS, MAX_SAMPLES, MAX_TIMBRES, MAX_WAVES, MIN_SAMPLES, OPERATOR_FIELDS, SettingsError,
} from "./settings.js";

/** @typedef {import("./settings.js").SynthSettings} SynthSettings */

const MAX_ROUTE = 10 + MAX_OPERATORS;
const MAX_TIME = 200000;

/**
 * The validation range of each operator field after `route` and `wave`: `[min, max]`.
 * @type {Record<string, [number, number]>}
 */
export const OPERATOR_RANGES = {
  volume: [0, 1000000],
  ratio: [0, 640000],
  offset_hz: [-200000000, 200000000],
  attack: [0, MAX_TIME],
  hold: [0, MAX_TIME],
  decay: [0, MAX_TIME],
  sustain: [0, 1000000],
  release: [0, MAX_TIME],
  pitch_ratio: [0, 160000],
  pitch_time: [0, MAX_TIME],
  key_scale: [-80000, 80000],
};

/**
 * Applies checks 1–30 of `src/settings.cairo`, in the same order and with the same messages and
 * indices, and throws a `SettingsError` on the first failure. Check 31 (length) belongs to the
 * encoder (player/encode.js). `customWaves` lifts the issue #2 gate (checks 7 and 17); it is false
 * in v1.
 * @param {SynthSettings} s
 * @param {{customWaves?: boolean}} [options]
 * @returns {SynthSettings} `s`
 */
export function validateSettings(s, { customWaves = false } = {}) {
  /** @param {boolean} ok @param {string} code @param {number[]} [indices] */
  const check = (ok, code, indices = []) => {
    if (!ok) throw new SettingsError(code, indices);
  };
  /** @param {string} name */
  const range = (name) => "TS: " + name + " out of range";
  check(s.quality <= 1, range("quality"));
  check(s.reverb <= 100, range("reverb"));
  check(s.master_vol <= 100, range("master_vol"));
  check(s.voices >= 1 && s.voices <= 64, range("voices"));
  check(s.waves.length <= MAX_WAVES, "TS: too many waves");
  s.waves.forEach((wave, w) => {
    if ("Harmonics" in wave) {
      const n = wave.Harmonics.length;
      check(n >= 1 && n <= MAX_HARMONICS, "TS: harmonics length", [w]);
    } else {
      const n = wave.Samples.length;
      check(n >= MIN_SAMPLES && n <= MAX_SAMPLES, "TS: samples length", [w]);
    }
  });
  check(customWaves || s.waves.length === 0, "TS: custom wave unsupported");
  check(s.timbres.length <= MAX_TIMBRES, "TS: too many timbres");
  const used = new Set();
  s.timbres.forEach((timbre, t) => {
    const { drum, slot, operators } = timbre;
    if (drum) check(slot >= 35 && slot <= 81, range("drum slot"), [t]);
    else check(slot <= 127, range("program slot"), [t]);
    const key = (drum ? 128 : 0) + slot;
    check(!used.has(key), "TS: duplicate timbre slot", [t]);
    used.add(key);
    check(operators.length >= 1, "TS: no operators", [t]);
    check(operators.length <= MAX_OPERATORS, "TS: too many operators", [t]);
    operators.forEach((op, o) => {
      const at = [t, o];
      const pos = o + 1;
      const r = op.route;
      check(r <= MAX_ROUTE, range("route"), at);
      check(!(r >= 1 && r <= 10 && r >= pos), "TS: FM target not earlier", at);
      check(!(r >= 11 && r - 10 >= pos), "TS: AM target not earlier", at);
      if (typeof op.wave === "object") {
        check(customWaves, "TS: custom wave unsupported", at);
        check(op.wave.Custom < s.waves.length, range("wave index"), at);
      }
      for (const [name] of OPERATOR_FIELDS) {
        const [lo, hi] = OPERATOR_RANGES[name];
        const v = /** @type {Record<string, any>} */ (op)[name];
        check(v >= lo && v <= hi, range(name), at);
      }
      check(op.filter === null, "TS: filter unsupported", at);
    });
  });
  return s;
}
