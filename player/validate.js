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

/** @typedef {import("./settings.js").TinySynthSettings} TinySynthSettings */

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
const MAX_ROUTE = 10 + MAX_OPERATORS;

/**
 * Applies the checks of `src/settings.cairo`, in the same order and with the same messages and
 * indices, and throws a `SettingsError` on the first failure. The other numeric fields, and every
 * wave sample and harmonic, take any value of their type, except a filter's cutoff and Q, which
 * must be above 0 (checks 16-17).
 * @param {TinySynthSettings} s
 * @returns {TinySynthSettings} `s`
 */
export function validateSettings(s) {
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
      if (typeof op.wave === "object") check(op.wave.Custom < s.waves.length, range("wave index"), at);
      if (op.filter !== null) {
        check(r === 0, "TS: filter on modulator", at);
        check(op.filter.cutoff > 0, range("filter cutoff"), at);
        check(op.filter.q > 0, range("filter q"), at);
      }
    });
  });
  return s;
}
