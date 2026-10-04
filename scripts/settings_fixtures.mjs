// @ts-check
// Shared SETTINGS fixtures: the single source for the Cairo/JS parity tests, the gas
// measurements and the reference timbres. `gen_settings_fixtures.mjs` turns them into
// tests/fixtures/settings.json and tests/settings_fixtures.cairo.
//
// Values are stored integers (fixed-point fields in units of 1/10000), in the JSON shape of
// player/settings.js: waves as {Harmonics: [...]} / {Samples: [...]}, wave as a variant name or
// {Custom: i}, filter as null or {kind, cutoff, key_track, q}.

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

/**
 * The interim engine limits (checks 17-20 of src/settings.cairo): the fields that multiply into the
 * engine's gains and frequencies at their bounds, 100.0, 64.0, 16.0 and +-8.0. Past them the
 * pinned engine computes non-finite AudioParam values and throws while playing
 * (scripts/page_check.mjs plays the fixtures at these values).
 */
const BOUNDS = { volume: 1000000, ratio: 640000, pitch_ratio: 160000, key_scale: 80000 };

/**
 * Widest valid operator at position `o` in v1: every field at its widest value (its bound for the
 * four bounded fields, the type's extreme for the others), and an AM route (two digits) after the
 * first operator.
 * @param {number} o
 */
export const widestOperator = (o) => op({
  route: o === 0 ? 0 : 10 + o, wave: "MetallicNoise", volume: BOUNDS.volume, ratio: BOUNDS.ratio, offset_hz: I32_MIN,
  attack: U32_MAX, hold: U32_MAX, decay: U32_MAX, sustain: U32_MAX, release: U32_MAX, pitch_ratio: BOUNDS.pitch_ratio,
  pitch_time: U32_MAX, key_scale: -BOUNDS.key_scale,
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
 * Every field at its maximum, with routes at their limits (FM on op 7 from op 8, AM chains): the
 * type's maximum, or the bound for the four bounded fields.
 */
const MAX_FIELDS = settings({
  quality: 1, reverb: 255, master_vol: 255, voices: 255,
  timbres: [{
    drum: false, slot: 127,
    operators: [0, 1, 2, 12, 4, 15, 6, 17].map((route) => op({
      route, wave: "Sawtooth", offset_hz: I32_MAX, attack: U32_MAX, hold: U32_MAX, decay: U32_MAX,
      sustain: U32_MAX, release: U32_MAX, pitch_time: U32_MAX, ...BOUNDS,
    })),
  }],
});

/** Every field at its minimum (`key_scale` at its bound, -8.0). */
const MIN_FIELDS = settings({
  quality: 0, reverb: 0, master_vol: 0, voices: 1,
  timbres: [{ drum: true, slot: 35, operators: [op({ ...NARROW, offset_hz: I32_MIN, key_scale: -BOUNDS.key_scale })] }],
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
  { name: "min_fields", settings: MIN_FIELDS },
  { name: "slot_edges", settings: SLOT_EDGES },
  { name: "all_builtin_waves", settings: ALL_WAVES },
  { name: "every_slot", settings: EVERY_SLOT },
];

/**
 * Encodable settings that v1 validation rejects (issues #2 and #3): pins the encoding of the
 * reserved shapes and the v1 rejection.
 * @type {Array<{name: string, settings: SynthSettings, error: [string, ...number[]]}>}
 */
export const RESERVED = [
  {
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
    error: ["TS: custom wave unsupported"],
  },
  {
    name: "custom_wave_without_table",
    settings: settings({ timbres: [{ drum: false, slot: 0, operators: [op({ wave: { Custom: 255 } })] }] }),
    error: ["TS: custom wave unsupported", 0, 0],
  },
  {
    name: "filters",
    settings: settings({
      timbres: [{
        drum: true, slot: 42,
        operators: [
          op({ wave: "MetallicNoise", filter: { kind: "HighPass", cutoff: 30000000, key_track: false, q: 7071 } }),
          op({ wave: "Sawtooth", filter: { kind: "LowPass", cutoff: 40000, key_track: true, q: 300000 } }),
          op({ filter: { kind: "BandPass", cutoff: 200000, key_track: false, q: 1000 } }),
        ],
      }],
    }),
    error: ["TS: filter unsupported", 0, 0],
  },
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
  // Settings-level checks (1-6).
  { name: "quality_2", settings: settings({ quality: 2 }), error: ["TS: quality out of range"] },
  { name: "voices_0", settings: settings({ voices: 0 }), error: ["TS: voices out of range"] },
  { name: "waves_257", settings: settings({ waves: Array(257).fill({ Harmonics: [1] }) }), error: ["TS: too many waves"] },
  { name: "harmonics_0", settings: settings({ waves: [{ Harmonics: [1] }, { Harmonics: [] }] }), error: ["TS: harmonics length", 1] },
  { name: "samples_0", settings: settings({ waves: [{ Samples: [0] }, { Harmonics: [1] }, { Samples: [] }] }), error: ["TS: samples length", 2] },
  {
    // 256 waves, the shortest and some long ones (wave lengths have no upper bound): only the v1
    // gate rejects it.
    name: "waves_256_valid",
    settings: settings({
      waves: [...Array(253).fill({ Harmonics: [1] }), { Samples: [-128] }, { Harmonics: Array(300).fill(65535) }, { Samples: Array(2000).fill(-1) }],
    }),
    error: ["TS: custom wave unsupported"],
  },
  {
    // One more timbre than there are slots, so a duplicate is unavoidable: the count fails first.
    name: "timbres_176",
    settings: settings({ timbres: [...EVERY_SLOT.timbres, { drum: false, slot: 0, operators: [op({})] }] }),
    error: ["TS: too many timbres"],
  },
  // Timbre checks (7-11).
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
  // Routing (12-14).
  { name: "route_19", settings: routeAt(8, 19), error: ["TS: route out of range", 0, 7] },
  { name: "route_255", settings: routeAt(1, 255), error: ["TS: route out of range", 0, 0] },
  { name: "fm_on_first_operator", settings: routeAt(1, 1), error: ["TS: FM target not earlier", 0, 0] },
  { name: "fm_on_itself", settings: routeAt(2, 2), error: ["TS: FM target not earlier", 0, 1] },
  { name: "fm_on_later", settings: routeAt(3, 10), error: ["TS: FM target not earlier", 0, 2] },
  { name: "am_on_first_operator", settings: routeAt(1, 11), error: ["TS: AM target not earlier", 0, 0] },
  { name: "am_on_itself", settings: routeAt(2, 12), error: ["TS: AM target not earlier", 0, 1] },
  { name: "am_route_18_at_8", settings: routeAt(8, 18), error: ["TS: AM target not earlier", 0, 7] },
  // Custom wave (15).
  { name: "custom_wave", settings: one({ wave: { Custom: 0 } }), error: ["TS: custom wave unsupported", 0, 0] },
  // Interim engine limits (17-20): one past each bound.
  { name: "volume_max_plus_1", settings: one({ volume: 1000001 }), error: ["TS: volume out of range", 0, 0] },
  { name: "ratio_max_plus_1", settings: one({ ratio: 640001 }), error: ["TS: ratio out of range", 0, 0] },
  { name: "pitch_ratio_max_plus_1", settings: one({ pitch_ratio: 160001 }), error: ["TS: pitch_ratio out of range", 0, 0] },
  { name: "key_scale_max_plus_1", settings: one({ key_scale: 80001 }), error: ["TS: key_scale out of range", 0, 0] },
  { name: "key_scale_min_minus_1", settings: one({ key_scale: -80001 }), error: ["TS: key_scale out of range", 0, 0] },
  { name: "u32_max_ratio", settings: one({ ratio: U32_MAX }), error: ["TS: ratio out of range", 0, 0] },
  { name: "i32_max_key_scale", settings: one({ key_scale: I32_MAX }), error: ["TS: key_scale out of range", 0, 0] },
  // Filter (21).
  { name: "filter", settings: one({ filter: { kind: "LowPass", cutoff: 10000000, key_track: false, q: 7071 } }), error: ["TS: filter unsupported", 0, 0] },
  // Check order: the first failing check wins.
  { name: "order_quality_before_voices", settings: settings({ quality: 2, voices: 0 }), error: ["TS: quality out of range"] },
  { name: "order_voices_before_waves", settings: settings({ voices: 0, waves: [{ Harmonics: [] }] }), error: ["TS: voices out of range"] },
  { name: "order_wave_length_before_v1_gate", settings: settings({ waves: [{ Harmonics: [1] }, { Samples: [] }] }), error: ["TS: samples length", 1] },
  {
    name: "order_v1_wave_gate_before_timbres",
    settings: settings({ waves: [{ Harmonics: [1] }], timbres: [{ drum: false, slot: 200, operators: [] }] }),
    error: ["TS: custom wave unsupported"],
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
  { name: "order_custom_before_volume", settings: one({ wave: { Custom: 0 }, volume: 1000001 }), error: ["TS: custom wave unsupported", 0, 0] },
  { name: "order_volume_before_ratio", settings: one({ volume: 1000001, ratio: 640001 }), error: ["TS: volume out of range", 0, 0] },
  { name: "order_ratio_before_pitch_ratio", settings: one({ ratio: 640001, pitch_ratio: 160001 }), error: ["TS: ratio out of range", 0, 0] },
  { name: "order_pitch_ratio_before_key_scale", settings: one({ pitch_ratio: 160001, key_scale: -80001 }), error: ["TS: pitch_ratio out of range", 0, 0] },
  {
    name: "order_key_scale_before_filter",
    settings: one({ key_scale: 80001, filter: { kind: "LowPass", cutoff: 1, key_track: false, q: 1 } }),
    error: ["TS: key_scale out of range", 0, 0],
  },
  {
    name: "order_custom_before_filter",
    settings: one({ wave: { Custom: 0 }, filter: { kind: "LowPass", cutoff: 1, key_track: false, q: 1 } }),
    error: ["TS: custom wave unsupported", 0, 0],
  },
];
