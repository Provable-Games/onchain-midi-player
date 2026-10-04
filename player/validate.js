// @ts-check
/**
 * JS reference of Cairo's `settings::validate` (src/settings.cairo), for Node and tooling only: the
 * fixture generators, the reference encoder's callers and the parity tests. It is not part of the
 * page: semantic validation is the class's job, and the page only parses SETTINGS
 * strictly (`decodeSettings` in player/settings.js).
 *
 * Mirrors the Cairo checks one for one, in the same order and with the same messages and indices;
 * the shared fixtures (tests/fixtures/settings.json) assert it on both sides.
 */
import { SettingsError } from "./settings.js";

/** @typedef {import("./settings.js").SynthSettings} SynthSettings */

// Cairo's caps, as in src/settings.cairo: what the format and the engine require. They equal the
// page's parse bounds (player/settings.js) but are kept apart from them, so a Cairo cap can change
// within those bounds without changing the page.
/** All that `Waveform::Custom(u8)` can index. */
export const MAX_WAVES = 256;
/** Every slot reachable from MIDI: 128 programs and 47 drum notes. */
export const MAX_TIMBRES = 175;
export const MAX_OPERATORS = 8;
/** Fewest harmonics per wave: the engine takes at least 2 entries, the first for DC (fork #26, D-028). */
export const MIN_HARMONICS = 1;
/** Fewest samples per wave: the engine takes any non-empty table (fork #26, D-028). */
export const MIN_SAMPLES = 1;
/** Fewest voices: with none, every note would be cut. */
export const MIN_VOICES = 1;
/**
 * Interim engine limits (checks 17-21), in fixed point: the pinned engine computes non-finite
 * AudioParam values past them and throws while playing. To be removed once it guards them (fork
 * #13, T5).
 */
export const MAX_VOLUME = 1000000;
export const MAX_RATIO = 640000;
export const MAX_PITCH_RATIO = 160000;
export const MAX_SUSTAIN = 1000000;
export const MAX_KEY_SCALE = 80000;
const MAX_ROUTE = 10 + MAX_OPERATORS;

/**
 * Applies the checks of `src/settings.cairo`, in the same order and with the same messages and
 * indices, and throws a `SettingsError` on the first failure. `customWaves` lifts the issue #2 gate
 * (checks 5 and 15); it is false in v1. The other numeric fields take any value of their type,
 * except the interim engine limits (checks 17-21).
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
  check(s.voices >= MIN_VOICES, range("voices"));
  check(s.waves.length <= MAX_WAVES, "TS: too many waves");
  s.waves.forEach((wave, w) => {
    if ("Harmonics" in wave) {
      const n = wave.Harmonics.length;
      check(n >= MIN_HARMONICS, "TS: harmonics length", [w]);
    } else {
      const n = wave.Samples.length;
      check(n >= MIN_SAMPLES, "TS: samples length", [w]);
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
      check(op.volume <= MAX_VOLUME, range("volume"), at);
      check(op.ratio <= MAX_RATIO, range("ratio"), at);
      check(op.pitch_ratio <= MAX_PITCH_RATIO, range("pitch_ratio"), at);
      check(op.sustain <= MAX_SUSTAIN, range("sustain"), at);
      check(op.key_scale >= -MAX_KEY_SCALE && op.key_scale <= MAX_KEY_SCALE, range("key_scale"), at);
      check(op.filter === null, "TS: filter unsupported", at);
    });
  });
  return s;
}
