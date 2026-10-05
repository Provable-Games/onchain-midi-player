// @ts-check
// Reference custom waves (issue #2): generic chip-sound shapes as `WaveDef::Samples` tables, generated
// from their definitions rather than listed. docs/sound-settings.md ("Custom waves") and the sound-design skill
// describe them, scripts/settings_fixtures.mjs builds fixtures from them (Cairo/JS parity and gas),
// and scripts/render_check.mjs renders them (pitch, pulse width and stepped character).
//
// Each value is an i8 sample; the player passes `s / 128` to the engine's `setSampleWave`, which
// plays one table per cycle of the note, so a table's pitch is the note's whatever its length.

/**
 * A 4-bit level (0..=15) as an i8 sample: 0 is -128 and 15 is 127, every level 17 apart.
 * @param {number} v
 */
export const level4 = (v) => v * 17 - 128;

/**
 * A 64-step 4-bit stepped triangle: the classic chip triangle, levels 15 down to 0 and back up to
 * 15 (32 steps), each held for 2 samples.
 * @returns {number[]}
 */
export const triangle4 = () => Array.from({ length: 64 }, (_, i) => {
  const j = i >> 1;
  return level4(j < 16 ? 15 - j : j - 16);
});

/**
 * A pulse wave of 8 samples, `high` of them at 127 and the rest at -128: 1 is a 12.5% pulse, 2 is 25%,
 * 4 is 50% (a square).
 * @param {number} high
 * @returns {number[]}
 */
export const pulse = (high) => Array.from({ length: 8 }, (_, i) => (i < high ? 127 : -128));

/**
 * A 16-step 4-bit sawtooth: levels 0 up to 15, then back to 0.
 * @returns {number[]}
 */
export const saw4 = () => Array.from({ length: 16 }, (_, i) => level4(i));

/**
 * One period of a 15-bit linear-feedback shift register, from state 1, as chip noise channels
 * clock it: each step outputs bit 0 (1 is low: -128, 0 is high: 127), shifts right and feeds back
 * bit 0 XOR bit 1 (long mode, 32,767 steps) or bit 0 XOR bit 6 (short mode, 93 steps from state 1,
 * a metallic, pitched noise).
 * @param {"long" | "short"} mode
 * @returns {number[]}
 */
export function lfsr(mode) {
  const tap = mode === "short" ? 6 : 1;
  const out = [];
  let r = 1;
  do {
    out.push(r & 1 ? -128 : 127);
    r = (r >> 1) | (((r ^ (r >> tap)) & 1) << 14);
  } while (r !== 1);
  return out;
}

/**
 * The reference waves, by name, in the order the `reference_waves` fixture lists them.
 * @type {Array<[string, number[]]>}
 */
export const REFERENCE_WAVES = [
  ["triangle4", triangle4()],
  ["pulse12", pulse(1)],
  ["pulse25", pulse(2)],
  ["pulse50", pulse(4)],
  ["saw4", saw4()],
  ["lfsr_short", lfsr("short")],
];
