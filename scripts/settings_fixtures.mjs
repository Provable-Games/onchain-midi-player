// @ts-check
// Shared SETTINGS fixtures: the single source for the Cairo/JS parity tests, the gas
// measurements and the reference timbres. `gen_settings_fixtures.mjs` turns them into
// tests/fixtures/settings.json and tests/settings_fixtures.cairo.
//
// Values are stored integers (fixed-point fields in units of 1/10000), in the JSON shape of
// player/settings.js: waves as {Harmonics: [...]} / {Samples: [...]}, wave as a variant name or
// {Custom: i}, filter as null or {kind, cutoff, key_track, q}.

import { REFERENCE_WAVES, lfsr, triangle4 } from "./reference_waves.mjs";

/** @typedef {import("../player/settings.js").SynthSettings} SynthSettings */
/** @typedef {import("../player/settings.js").Operator} Operator */
/** @typedef {import("../player/settings.js").Timbre} Timbre */

/** TinySynth's operator defaults, as `default_operator()` in src/settings.cairo. */
export const DEFAULT_OPERATOR = Object.freeze({
  route: 0, wave: "Sine", volume: 5000, ratio: 10000, offset_hz: 0, attack: 0, hold: 100, decay: 100,
  sustain: 0, release: 500, pitch_ratio: 10000, pitch_time: 10000, key_scale: 0, filter: null,
});

/**
 * @param {Partial<Operator>} fields
 * @returns {Operator}
 */
export const op = (fields) => /** @type {Operator} */ ({ ...DEFAULT_OPERATOR, ...fields });

/** @type {SynthSettings} */
export const DEFAULT_SETTINGS = { quality: 1, reverb: 30, master_vol: 40, voices: 64, waves: [], timbres: [] };

/**
 * @param {Partial<SynthSettings>} fields
 * @returns {SynthSettings}
 */
const settings = (fields) => ({ ...DEFAULT_SETTINGS, ...fields });

// ------------------------------------------------------------------------------------------
// Reference timbres (issue #1 spec, section 7): the Beast lead, kick and snare.
// ------------------------------------------------------------------------------------------

/** Lead: triangle carrier plus a 6 Hz triangle LFO giving +-30 cents of vibrato, faded in over 0.2 s. */
export const BEAST_LEAD = {
  drum: false,
  slot: 0,
  operators: [
    op({ wave: "Triangle", volume: 3000, attack: 30, hold: 0, decay: 100, sustain: 10000, release: 100 }),
    op({
      route: 1, wave: "Triangle", volume: 175, ratio: 0, offset_hz: 60000, attack: 2000, hold: 0,
      decay: 100, sustain: 10000, release: 100,
    }),
  ],
};

/** Kick: triangle falling 160 -> 45 Hz (time constant 30 ms) plus a short white-noise click. */
export const BEAST_KICK = {
  drum: true,
  slot: 36,
  operators: [
    op({
      wave: "Triangle", volume: 4000, ratio: 0, offset_hz: 1600000, attack: 30, hold: 370, decay: 500,
      sustain: 0, release: 500, pitch_ratio: 2813, pitch_time: 300,
    }),
    op({ wave: "WhiteNoise", volume: 1000, ratio: 0, offset_hz: 4400000, attack: 20, hold: 0, decay: 30, release: 500 }),
  ],
};

/** Snare: white noise at playback rate 0.6 plus a square body falling 200 -> 110 Hz. */
export const BEAST_SNARE = {
  drum: true,
  slot: 38,
  operators: [
    op({ wave: "WhiteNoise", volume: 3500, ratio: 0, offset_hz: 2640000, attack: 30, hold: 0, decay: 500, release: 500 }),
    op({
      wave: "Square", volume: 700, ratio: 0, offset_hz: 2000000, attack: 30, hold: 0, decay: 200,
      release: 500, pitch_ratio: 5500, pitch_time: 170,
    }),
  ],
};

/** The Beast reference settings: no reverb, as on the production page. */
export const BEAST_SETTINGS = settings({ reverb: 0, timbres: [BEAST_LEAD, BEAST_KICK, BEAST_SNARE] });

/** Closed and open hats (metallic noise), for the 6-timbre fixture. */
const HAT_CLOSED = {
  drum: true, slot: 42,
  operators: [op({ wave: "MetallicNoise", volume: 2000, ratio: 0, offset_hz: 3900000, hold: 0, decay: 150, release: 500 })],
};
const HAT_OPEN = { ...HAT_CLOSED, slot: 46, operators: [op({ ...HAT_CLOSED.operators[0], decay: 600 })] };
/** Triangle bass an octave down. */
const BASS = {
  drum: false, slot: 33,
  operators: [op({ wave: "Triangle", volume: 3500, ratio: 5000, attack: 30, hold: 0, sustain: 10000, release: 100 })],
};

// ------------------------------------------------------------------------------------------
// Sizes at the caps.
// ------------------------------------------------------------------------------------------

/** Narrowest valid operator: every field 0 (28 bytes with its leading comma). */
const NARROW = op({ volume: 0, ratio: 0, hold: 0, decay: 0, release: 0, pitch_ratio: 0, pitch_time: 0 });

/** Integer type extremes: the only bounds of the numeric fields that the class does not check. */
const U32_MAX = 4294967295;
const I32_MIN = -2147483648;
const I32_MAX = 2147483647;

/** The fields that multiply into the engine's gains and frequencies, at their type's maximum. */
const EXTREMES = { volume: U32_MAX, ratio: U32_MAX, pitch_ratio: U32_MAX, sustain: U32_MAX, key_scale: I32_MAX };

/**
 * The same fields at 100.0, 64.0, 16.0, 100.0 and +-8.0 (the class's interim bounds before the
 * engine's T5.2 guard): large values at which the deepest FM chain still plays notes 0 and 127. Past
 * them the engine can skip a note whose computed values overflow float32, so the filter fixture uses
 * these, for its filters to be played rather than skipped (scripts/page_check.mjs checks that they are).
 */
const LOUD = { volume: 1000000, ratio: 640000, pitch_ratio: 160000, sustain: 1000000, key_scale: 80000 };

/** The widest filter (issue #3): cutoff and Q at the `u32` maximum, key-tracked. */
const WIDEST_FILTER = /** @type {const} */ ({ kind: "BandPass", cutoff: U32_MAX, key_track: true, q: U32_MAX });

/**
 * Widest valid operator in v1, at any position `o`: every field at its widest value (the type's
 * extreme), and the widest filter, so an audio output (route 0: only an output may have a filter,
 * and a filter is far wider than a two-digit AM route).
 * @param {number} _o
 */
export const widestOperator = (_o) => op({
  route: 0, wave: "MetallicNoise", volume: U32_MAX, ratio: U32_MAX, offset_hz: I32_MIN,
  attack: U32_MAX, hold: U32_MAX, decay: U32_MAX, sustain: U32_MAX, release: U32_MAX, pitch_ratio: U32_MAX,
  pitch_time: U32_MAX, key_scale: I32_MIN, filter: WIDEST_FILTER,
});

/** Every timbre slot reachable from MIDI, in order: programs 0..=127, then drum notes 35..=81. */
export const ALL_SLOTS = /** @type {Array<[boolean, number]>} */ ([
  ...Array.from({ length: 128 }, (_, i) => [false, i]),
  ...Array.from({ length: 47 }, (_, i) => [true, 35 + i]),
]);

/** One timbre on every slot (175, the cap), each with TinySynth's default operator. */
const EVERY_SLOT = settings({ timbres: ALL_SLOTS.map(([drum, slot]) => ({ drum, slot, operators: [op({})] })) });

/**
 * The largest valid SETTINGS in v1, which is both the most validation work and the most encoding
 * work: every slot (175 timbres), 8 operators each, every field at its widest. Too large for a
 * Cairo literal, so the generator pins only its length and SHA-256, and tests/settings_fixtures.cairo
 * builds the same value in a loop (`structural_max()`).
 * @returns {SynthSettings}
 */
export const structuralMax = () => settings({
  reverb: 255, master_vol: 255, voices: 255,
  timbres: ALL_SLOTS.map(([drum, slot]) => ({ drum, slot, operators: Array.from({ length: 8 }, (_, o) => widestOperator(o)) })),
});

// ------------------------------------------------------------------------------------------
// Boundaries.
// ------------------------------------------------------------------------------------------

/**
 * Every field at its type's maximum, with routes at their limits (FM on op 7 from op 8, AM chains);
 * the audio output (operator 1) has the widest filter.
 */
const MAX_FIELDS = settings({
  quality: 1, reverb: 255, master_vol: 255, voices: 255,
  timbres: [{
    drum: false, slot: 127,
    operators: [0, 1, 2, 12, 4, 15, 6, 17].map((route) => op({
      route, wave: "Sawtooth", offset_hz: I32_MAX, attack: U32_MAX, hold: U32_MAX, decay: U32_MAX,
      release: U32_MAX, pitch_time: U32_MAX, ...EXTREMES, filter: route === 0 ? WIDEST_FILTER : null,
    })),
  }],
});

/**
 * The deepest FM chain, each operator modulating the one before (routes 0..7), with the fields that
 * multiply into the gains and frequencies at their type's maximum: `ratio` and the gains compound
 * once per level, so its computed values overflow float32 and the engine skips its notes.
 */
const MAX_CHAIN = settings({
  timbres: [{ drum: false, slot: 0, operators: Array.from({ length: 8 }, (_, route) => op({ route, ...EXTREMES })) }],
});

/** Every field at its type's minimum. */
const MIN_FIELDS = settings({
  quality: 0, reverb: 0, master_vol: 0, voices: 1,
  timbres: [{ drum: true, slot: 35, operators: [op({ ...NARROW, offset_hz: I32_MIN, key_scale: I32_MIN })] }],
});

/** Slot edges, and the same number in both banks (programs and drums are separate). */
const SLOT_EDGES = settings({
  timbres: [
    { drum: false, slot: 0, operators: [op({})] },
    { drum: false, slot: 127, operators: [op({})] },
    { drum: true, slot: 35, operators: [op({})] },
    { drum: true, slot: 81, operators: [op({})] },
    { drum: false, slot: 36, operators: [op({})] },
    { drum: true, slot: 36, operators: [op({})] },
  ],
});

/** All six built-in waveforms. */
const ALL_WAVES = settings({
  timbres: [{
    drum: false, slot: 1,
    operators: /** @type {Array<Operator["wave"]>} */ (["Sine", "Square", "Sawtooth", "Triangle", "WhiteNoise", "MetallicNoise"])
      .map((wave) => op({ wave })),
  }],
});

// ------------------------------------------------------------------------------------------
// Custom waves (issue #2), from the reference waves (scripts/reference_waves.mjs).
// ------------------------------------------------------------------------------------------

/** The Beast lead (above) on the 64-step 4-bit stepped triangle, custom wave 0, with its vibrato. */
export const CHIP_LEAD = {
  drum: false,
  slot: 0,
  operators: [op({ ...BEAST_LEAD.operators[0], wave: { Custom: 0 } }), BEAST_LEAD.operators[1]],
};

/** One custom wave: the stepped triangle, for the chip lead. */
const ONE_WAVE = settings({ reverb: 0, waves: [{ Samples: triangle4() }], timbres: [CHIP_LEAD] });

/** A melodic chip voice on custom wave `w`: full sustain, 3 ms attack, 10 ms release. */
const chipVoice = (/** @type {number} */ slot, /** @type {number} */ w, /** @type {Partial<Operator>} */ fields = {}) => ({
  drum: false, slot,
  operators: [op({ wave: { Custom: w }, volume: 3000, attack: 30, hold: 0, sustain: 10000, release: 100, ...fields })],
});

/**
 * Every reference wave, each on a timbre: programs 0-4 play the stepped triangle, the three pulses
 * and the saw (no vibrato, so pitch and pulse width can be measured), and a chip kit on drums 36,
 * 38 and 42: a stepped-triangle kick falling 160 -> 45 Hz, a short-LFSR snare with a square body,
 * and a short-LFSR hat. A noise table steps `n` times per cycle, so a noise operator is set by its
 * step rate: `offset_hz` = steps per second / `n` (here 93 steps at 20 and 40 kHz), with `ratio` 0.
 */
export const REFERENCE_WAVES_SETTINGS = settings({
  waves: REFERENCE_WAVES.map(([, samples]) => ({ Samples: samples })),
  timbres: [
    chipVoice(0, 0),
    chipVoice(1, 1),
    chipVoice(2, 2),
    chipVoice(3, 3),
    chipVoice(4, 4, { ratio: 5000 }),
    {
      drum: true, slot: 36,
      operators: [op({
        wave: { Custom: 0 }, volume: 4000, ratio: 0, offset_hz: 1600000, attack: 30, hold: 370, decay: 500,
        release: 500, pitch_ratio: 2813, pitch_time: 300,
      })],
    },
    {
      drum: true, slot: 38,
      operators: [
        op({ wave: { Custom: 5 }, volume: 3500, ratio: 0, offset_hz: 2150538, attack: 30, hold: 0, decay: 500, release: 500 }),
        op({
          wave: { Custom: 3 }, volume: 700, ratio: 0, offset_hz: 2000000, attack: 30, hold: 0, decay: 200,
          release: 500, pitch_ratio: 5500, pitch_time: 170,
        }),
      ],
    },
    {
      drum: true, slot: 42,
      operators: [op({ wave: { Custom: 5 }, volume: 2000, ratio: 0, offset_hz: 4301075, hold: 0, decay: 150, release: 500 })],
    },
  ],
});

/**
 * The long-mode LFSR (32,767 steps) as one custom wave, on a snare (drum 38) stepping at 48 kHz:
 * `offset_hz` 48,000 / 32,767 = 1.4649 Hz. About 147 KB of SETTINGS, so tests/settings_fixtures.cairo
 * builds it in a loop (`long_lfsr()`) and the generator pins only its length and SHA-256.
 * @returns {SynthSettings}
 */
export const longLfsr = () => settings({
  waves: [{ Samples: lfsr("long") }],
  timbres: [{ drum: true, slot: 38, operators: [LONG_LFSR_SNARE] }],
});

/** The operator of `longLfsr()`'s snare. */
export const LONG_LFSR_SNARE = op({ wave: { Custom: 0 }, volume: 3000, ratio: 0, offset_hz: 14649, hold: 0, decay: 500, release: 500 });

// ------------------------------------------------------------------------------------------
// Filters (issue #3).
// ------------------------------------------------------------------------------------------

/**
 * @param {"LowPass" | "HighPass" | "BandPass"} kind
 * @param {number} cutoff stored: Hz x 10,000, or the multiple of the note frequency x 10,000 when key-tracked
 * @param {number} q stored: linear Q x 10,000 (7,071: Butterworth for low- and high-pass)
 * @param {boolean} [key_track]
 * @returns {import("../player/settings.js").Filter}
 */
export const filter = (kind, cutoff, q, key_track = false) => ({ kind, cutoff, key_track, q });

/** The Beast reference settings with one filter: the lead's carrier through a low-pass at 4x the note frequency. */
const ONE_FILTER = settings({
  ...BEAST_SETTINGS,
  timbres: [
    { ...BEAST_LEAD, operators: [op({ ...BEAST_LEAD.operators[0], filter: filter("LowPass", 40000, 7071, true) }), BEAST_LEAD.operators[1]] },
    BEAST_KICK,
    BEAST_SNARE,
  ],
});

/** A melodic sawtooth voice: full sustain, 3 ms attack, 10 ms release, through `f`. */
const sawVoice = (/** @type {number} */ slot, /** @type {Operator["filter"]} */ f) => ({
  drum: false, slot,
  operators: [op({ wave: "Sawtooth", volume: 3000, attack: 30, hold: 0, sustain: 10000, release: 100, filter: f })],
});

/** A chip hi-hat: metallic noise at playback rate 390 / 440, through a 3 kHz high-pass (issue #3's case). */
const filteredHat = (/** @type {number} */ slot, /** @type {number} */ decay) => ({
  drum: true, slot,
  operators: [op({
    wave: "MetallicNoise", volume: 2000, ratio: 0, offset_hz: 3900000, hold: 0, decay, release: 500,
    filter: filter("HighPass", 30000000, 7071),
  })],
});

/**
 * Six filtered operators, one of each use: sawtooth voices through a 1 kHz low-pass, high-pass and
 * band-pass (Q 4) on programs 0-2, a low-pass at 4x the note frequency on program 3 (a filtered lead
 * whose brightness follows the note), and closed and open hats high-passed at 3 kHz on drums 42 and
 * 46. `npm run render-check` measures them.
 */
export const FILTER_SETTINGS = settings({
  reverb: 0,
  timbres: [
    sawVoice(0, filter("LowPass", 10000000, 7071)),
    sawVoice(1, filter("HighPass", 10000000, 7071)),
    sawVoice(2, filter("BandPass", 10000000, 40000)),
    sawVoice(3, filter("LowPass", 40000, 7071, true)),
    filteredHat(42, 150),
    filteredHat(46, 600),
  ],
});

/**
 * Every filter at its extremes, with the multiplying fields at the large values that still play
 * (`LOUD`): each kind on its own timbre (programs 100-102) with eight outputs, one per combination of
 * cutoff (0.0001 or the u32 maximum), key tracking and Q (0.0001 or the u32 maximum); the deepest FM
 * chain at those values into a filtered output (program 103); and a drum (81) with key-tracked
 * filters at the u32 maximum. scripts/page_check.mjs plays notes 0 and 127 on each.
 */
const FILTER_EXTREMES = settings({
  timbres: [
    ...(/** @type {const} */ (["LowPass", "HighPass", "BandPass"])).map((kind, k) => ({
      drum: false, slot: 100 + k,
      operators: Array.from({ length: 8 }, (_, o) => op({
        wave: "Sawtooth", ...LOUD, key_scale: o % 2 ? -LOUD.key_scale : LOUD.key_scale,
        filter: filter(kind, o & 4 ? U32_MAX : 1, o & 1 ? U32_MAX : 1, Boolean(o & 2)),
      })),
    })),
    {
      drum: false, slot: 103,
      operators: Array.from({ length: 8 }, (_, route) => op({ route, ...LOUD, filter: route ? null : filter("LowPass", U32_MAX, U32_MAX, true) })),
    },
    {
      drum: true, slot: 81,
      operators: [op({ ...LOUD, filter: filter("HighPass", U32_MAX, 1, true) }), op({ ...LOUD, wave: "WhiteNoise", filter: filter("BandPass", U32_MAX, U32_MAX, true) })],
    },
  ],
});

// ------------------------------------------------------------------------------------------
// Fixture lists.
// ------------------------------------------------------------------------------------------

/**
 * Valid settings, with the expected SETTINGS text where it is pinned independently of the
 * encoder (otherwise the generator records the JS encoder's output, and Cairo must match it).
 * @type {Array<{name: string, settings: SynthSettings, expected?: string}>}
 */
export const VALID = [
  { name: "default", settings: DEFAULT_SETTINGS, expected: "1,1,30,40,64,0,0" },
  {
    name: "beast_reference",
    settings: BEAST_SETTINGS,
    expected:
      "1,1,0,40,64,0,3," +
      "0,0,2,0,3,3000,10000,0,30,0,100,10000,100,10000,10000,0,0,1,3,175,0,60000,2000,0,100,10000,100,10000,10000,0,0," +
      "1,36,2,0,3,4000,0,1600000,30,370,500,0,500,2813,300,0,0,0,4,1000,0,4400000,20,0,30,0,500,10000,10000,0,0," +
      "1,38,2,0,4,3500,0,2640000,30,0,500,0,500,10000,10000,0,0,0,1,700,0,2000000,30,0,200,0,500,5500,170,0,0",
  },
  { name: "six_timbres", settings: settings({ reverb: 0, timbres: [BEAST_LEAD, BEAST_KICK, BEAST_SNARE, HAT_CLOSED, HAT_OPEN, BASS] }) },
  { name: "max_fields", settings: MAX_FIELDS },
  { name: "max_chain", settings: MAX_CHAIN },
  { name: "min_fields", settings: MIN_FIELDS },
  { name: "slot_edges", settings: SLOT_EDGES },
  { name: "all_builtin_waves", settings: ALL_WAVES },
  { name: "every_slot", settings: EVERY_SLOT },
  // Custom waves (issue #2).
  { name: "one_wave", settings: ONE_WAVE },
  { name: "reference_waves", settings: REFERENCE_WAVES_SETTINGS },
  {
    // Both kinds, shared: two operators on one timbre, a harmonic wave at the u16 maximum and the
    // shortest sample wave; one wave unused.
    name: "custom_waves",
    settings: settings({
      waves: [
        { Harmonics: [100, 0, 55, 0, 32, 0, 18, 0, 10, 0, 6] },
        { Samples: [-128, -96, -64, -32, 0, 32, 64, 96, 127, 96, 64, 32, 0, -32, -64, -96] },
        { Harmonics: [65535] },
        { Samples: [127, -128] },
      ],
      timbres: [{ drum: false, slot: 80, operators: [op({ wave: { Custom: 1 } }), op({ route: 1, wave: { Custom: 0 } })] }],
    }),
  },
  {
    // 256 waves (all that Custom(u8) can index), the shortest and some long ones: wave lengths have no
    // upper bound. The last operator uses the last wave; an all-zero harmonic wave is silent.
    name: "waves_256",
    settings: settings({
      waves: [
        ...Array(252).fill({ Harmonics: [1] }), { Harmonics: [0, 0] }, { Samples: [-128] },
        { Harmonics: Array(300).fill(65535) }, { Samples: Array(2000).fill(-1) },
      ],
      timbres: [{ drum: false, slot: 0, operators: [op({ wave: { Custom: 252 } }), op({ wave: { Custom: 255 } })] }],
    }),
  },
  // Filters (issue #3).
  { name: "one_filter", settings: ONE_FILTER },
  { name: "filters", settings: FILTER_SETTINGS },
  { name: "filter_extremes", settings: FILTER_EXTREMES },
];

const one = (/** @type {Partial<Operator>} */ fields, slot = 0) => settings({ timbres: [{ drum: false, slot, operators: [op(fields)] }] });
const onTimbre = (/** @type {Partial<Timbre>} */ fields) => settings({ timbres: [{ drum: false, slot: 0, operators: [op({})], ...fields }] });
const routeAt = (/** @type {number} */ pos, /** @type {number} */ route) => settings({
  timbres: [{ drum: false, slot: 0, operators: Array.from({ length: pos }, (_, i) => op({ route: i === pos - 1 ? route : 0 })) }],
});

/**
 * Invalid settings, each with the expected Cairo panic data (message, then indices).
 * @type {Array<{name: string, settings: SynthSettings, error: [string, ...number[]]}>}
 */
export const INVALID = [
  // Settings-level checks (1-5).
  { name: "quality_2", settings: settings({ quality: 2 }), error: ["TS: quality out of range"] },
  { name: "voices_0", settings: settings({ voices: 0 }), error: ["TS: voices out of range"] },
  { name: "waves_257", settings: settings({ waves: Array(257).fill({ Harmonics: [1] }) }), error: ["TS: too many waves"] },
  { name: "harmonics_0", settings: settings({ waves: [{ Harmonics: [1] }, { Harmonics: [] }] }), error: ["TS: harmonics length", 1] },
  { name: "samples_0", settings: settings({ waves: [{ Samples: [0] }, { Harmonics: [1] }, { Samples: [] }] }), error: ["TS: samples length", 2] },
  {
    // One more timbre than there are slots, so a duplicate is unavoidable: the count fails first.
    name: "timbres_176",
    settings: settings({ timbres: [...EVERY_SLOT.timbres, { drum: false, slot: 0, operators: [op({})] }] }),
    error: ["TS: too many timbres"],
  },
  // Timbre checks (6-10).
  { name: "program_slot_128", settings: onTimbre({ slot: 128 }), error: ["TS: program slot out of range", 0] },
  { name: "drum_slot_34", settings: onTimbre({ drum: true, slot: 34 }), error: ["TS: drum slot out of range", 0] },
  { name: "drum_slot_82", settings: onTimbre({ drum: true, slot: 82 }), error: ["TS: drum slot out of range", 0] },
  { name: "drum_slot_0", settings: onTimbre({ drum: true, slot: 0 }), error: ["TS: drum slot out of range", 0] },
  {
    name: "duplicate_program",
    settings: settings({ timbres: [BEAST_LEAD, BEAST_KICK, { ...BEAST_LEAD, operators: [op({})] }] }),
    error: ["TS: duplicate timbre slot", 2],
  },
  { name: "duplicate_drum", settings: settings({ timbres: [BEAST_KICK, BEAST_SNARE, BEAST_KICK] }), error: ["TS: duplicate timbre slot", 2] },
  { name: "no_operators", settings: settings({ timbres: [BEAST_LEAD, { drum: false, slot: 1, operators: [] }] }), error: ["TS: no operators", 1] },
  { name: "operators_9", settings: onTimbre({ operators: Array(9).fill(op({})) }), error: ["TS: too many operators", 0] },
  // Routing (11-13).
  { name: "route_19", settings: routeAt(8, 19), error: ["TS: route out of range", 0, 7] },
  { name: "route_255", settings: routeAt(1, 255), error: ["TS: route out of range", 0, 0] },
  { name: "fm_on_first_operator", settings: routeAt(1, 1), error: ["TS: FM target not earlier", 0, 0] },
  { name: "fm_on_itself", settings: routeAt(2, 2), error: ["TS: FM target not earlier", 0, 1] },
  { name: "fm_on_later", settings: routeAt(3, 10), error: ["TS: FM target not earlier", 0, 2] },
  { name: "am_on_first_operator", settings: routeAt(1, 11), error: ["TS: AM target not earlier", 0, 0] },
  { name: "am_on_itself", settings: routeAt(2, 12), error: ["TS: AM target not earlier", 0, 1] },
  { name: "am_route_18_at_8", settings: routeAt(8, 18), error: ["TS: AM target not earlier", 0, 7] },
  // Wave index (14).
  { name: "custom_wave", settings: one({ wave: { Custom: 0 } }), error: ["TS: wave index out of range", 0, 0] },
  {
    name: "custom_wave_255_without_table",
    settings: settings({ timbres: [{ drum: false, slot: 0, operators: [op({ wave: { Custom: 255 } })] }] }),
    error: ["TS: wave index out of range", 0, 0],
  },
  {
    name: "custom_wave_past_table",
    settings: settings({
      waves: [{ Samples: triangle4() }, { Harmonics: [1, 0, 1] }],
      timbres: [
        CHIP_LEAD,
        { drum: true, slot: 81, operators: [op({ wave: { Custom: 1 } }), op({ route: 1, wave: { Custom: 0 } }), op({ wave: { Custom: 2 } })] },
      ],
    }),
    error: ["TS: wave index out of range", 1, 2],
  },
  // Filters (15-17).
  {
    name: "filter_on_fm",
    settings: onTimbre({ operators: [op({}), op({ route: 1, filter: filter("LowPass", 10000000, 7071) })] }),
    error: ["TS: filter on modulator", 0, 1],
  },
  {
    name: "filter_on_am",
    settings: onTimbre({ operators: [op({}), op({}), op({ route: 12, filter: filter("BandPass", 10000, 10000, true) })] }),
    error: ["TS: filter on modulator", 0, 2],
  },
  { name: "filter_cutoff_0", settings: one({ filter: filter("HighPass", 0, 7071) }), error: ["TS: filter cutoff out of range", 0, 0] },
  { name: "filter_cutoff_0_key_tracked", settings: one({ filter: filter("LowPass", 0, 7071, true) }), error: ["TS: filter cutoff out of range", 0, 0] },
  { name: "filter_q_0", settings: one({ filter: filter("BandPass", 10000000, 0) }), error: ["TS: filter q out of range", 0, 0] },
  // Check order: the first failing check wins.
  { name: "order_quality_before_voices", settings: settings({ quality: 2, voices: 0 }), error: ["TS: quality out of range"] },
  { name: "order_voices_before_waves", settings: settings({ voices: 0, waves: [{ Harmonics: [] }] }), error: ["TS: voices out of range"] },
  {
    name: "order_wave_count_before_timbres",
    settings: settings({ waves: Array(257).fill({ Samples: [0] }), timbres: [{ drum: false, slot: 200, operators: [] }] }),
    error: ["TS: too many waves"],
  },
  {
    name: "order_wave_length_before_timbres",
    settings: settings({ waves: [{ Harmonics: [1] }, { Samples: [] }], timbres: [{ drum: false, slot: 200, operators: [] }] }),
    error: ["TS: samples length", 1],
  },
  {
    name: "order_timbre_count_before_slot",
    settings: settings({ timbres: [{ drum: false, slot: 200, operators: [] }, ...EVERY_SLOT.timbres] }),
    error: ["TS: too many timbres"],
  },
  {
    name: "order_slot_before_operators",
    settings: settings({ timbres: [{ drum: true, slot: 99, operators: [] }] }),
    error: ["TS: drum slot out of range", 0],
  },
  {
    name: "order_duplicate_before_operators",
    settings: settings({ timbres: [BEAST_LEAD, { drum: false, slot: 0, operators: [] }] }),
    error: ["TS: duplicate timbre slot", 1],
  },
  {
    name: "order_timbre_0_before_timbre_1",
    settings: settings({ timbres: [{ drum: false, slot: 5, operators: [op({}), op({ route: 2 })] }, { drum: false, slot: 200, operators: [op({})] }] }),
    error: ["TS: FM target not earlier", 0, 1],
  },
  {
    name: "order_operator_0_before_operator_1",
    settings: settings({ timbres: [{ drum: false, slot: 5, operators: [op({ route: 19 }), op({ route: 9 })] }] }),
    error: ["TS: route out of range", 0, 0],
  },
  { name: "order_route_before_wave", settings: one({ route: 1, wave: { Custom: 0 } }), error: ["TS: FM target not earlier", 0, 0] },
  { name: "order_wave_index_before_filter", settings: one({ wave: { Custom: 0 }, filter: filter("LowPass", 0, 0) }), error: ["TS: wave index out of range", 0, 0] },
  {
    name: "order_filter_modulator_before_cutoff",
    settings: onTimbre({ operators: [op({}), op({ route: 1, filter: filter("LowPass", 0, 0) })] }),
    error: ["TS: filter on modulator", 0, 1],
  },
  { name: "order_filter_cutoff_before_q", settings: one({ filter: filter("HighPass", 0, 0, true) }), error: ["TS: filter cutoff out of range", 0, 0] },
  {
    name: "order_operator_0_filter_before_operator_1",
    settings: onTimbre({ operators: [op({ filter: filter("LowPass", 10000, 0) }), op({ route: 9 })] }),
    error: ["TS: filter q out of range", 0, 0],
  },
];
