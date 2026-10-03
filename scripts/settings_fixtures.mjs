// @ts-check
// Shared SETTINGS fixtures: the single source for the Cairo/JS parity tests, the gas
// measurements and the reference timbres. `gen_settings_fixtures.mjs` turns them into
// tests/fixtures/settings.json and tests/settings_fixtures.cairo.
//
// Values are stored integers (fixed-point fields in units of 1/10000), in the JSON shape of
// player/settings.js: waves as {Harmonics: [...]} / {Samples: [...]}, wave as a variant name or
// {Custom: i}, filter as null or {kind, cutoff, key_track, q}.

import { encodeSettings } from "../player/encode.js";

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

/** Widest valid operator at a given position: every field at its widest in-range value. */
const wide = (/** @type {number} */ o) => op({
  route: o === 0 ? 0 : 10 + o, wave: "MetallicNoise", volume: 1000000, ratio: 640000, offset_hz: -200000000,
  attack: 200000, hold: 200000, decay: 200000, sustain: 1000000, release: 200000, pitch_ratio: 160000,
  pitch_time: 200000, key_scale: -80000,
});

/** 32 timbres of 8 narrow operators: the most validation work (7,435 bytes). */
const MAX_COUNT_MIN_WIDTH = settings({
  timbres: Array.from({ length: 32 }, (_, i) => ({ drum: false, slot: 96 + i, operators: Array(8).fill(NARROW) })),
});

/**
 * 32 timbres filled with wide operators to exactly `target` bytes: the most encoding work.
 * Wide operators are added round-robin while they fit, the remainder is filled with narrow
 * operators, and the last few bytes by widening fields of narrow operators.
 * @param {number} target
 */
function filledTo(target) {
  /** @type {Timbre[]} */
  const timbres = Array.from({ length: 32 }, (_, i) => ({ drum: i % 2 === 1, slot: i % 2 ? 35 + i : i, operators: [] }));
  const len = () => encodeSettings(settings({ timbres }), { limit: Infinity }).length;
  const tryPush = (/** @type {Timbre} */ t, /** @type {(o: number) => Operator} */ make) => {
    if (t.operators.length >= 8) return false;
    t.operators.push(make(t.operators.length));
    if (len() <= target) return true;
    t.operators.pop();
    return false;
  };
  for (let added = true; added;) {
    added = false;
    for (const t of timbres) added = tryPush(t, wide) || added;
  }
  for (let added = true; added;) {
    added = false;
    for (const t of timbres) added = tryPush(t, () => NARROW) || added;
  }
  // Widen fields that are 0 (to 10^k, adding k bytes) until the length is exact.
  /** @type {Array<[string, number]>} field and the most digits it can gain within its range */
  const widenable = [["volume", 6], ["sustain", 6], ["ratio", 5], ["attack", 5], ["hold", 5], ["decay", 5], ["release", 5]];
  for (const t of timbres) {
    for (let o = 0; o < t.operators.length && len() < target; o++) {
      for (const [field, digits] of widenable) {
        const slack = target - len();
        if (slack === 0) break;
        if (/** @type {any} */ (t.operators[o])[field] !== 0) continue;
        t.operators[o] = op({ ...t.operators[o], [field]: 10 ** Math.min(slack, digits) });
      }
    }
  }
  const s = settings({ timbres });
  if (len() !== target) throw new Error(`could not fill to ${target} bytes (got ${len()})`);
  return s;
}

// ------------------------------------------------------------------------------------------
// Boundaries.
// ------------------------------------------------------------------------------------------

/** Every field at its maximum, with routes at their limits (FM on op 7 from op 8, AM chains). */
const MAX_FIELDS = settings({
  quality: 1, reverb: 100, master_vol: 100, voices: 64,
  timbres: [{
    drum: false, slot: 127,
    operators: [0, 1, 2, 12, 4, 15, 6, 17].map((route) => op({
      route, wave: "Sawtooth", volume: 1000000, ratio: 640000, offset_hz: 200000000, attack: 200000,
      hold: 200000, decay: 200000, sustain: 1000000, release: 200000, pitch_ratio: 160000,
      pitch_time: 200000, key_scale: 80000,
    })),
  }],
});

/** Every field at its minimum. */
const MIN_FIELDS = settings({
  quality: 0, reverb: 0, master_vol: 0, voices: 1,
  timbres: [{ drum: true, slot: 35, operators: [op({ ...NARROW, offset_hz: -200000000, key_scale: -80000 })] }],
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
  { name: "max_count_min_width", settings: MAX_COUNT_MIN_WIDTH },
  { name: "max_length", settings: filledTo(8192) },
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
  // Settings-level checks (1-8).
  { name: "quality_2", settings: settings({ quality: 2 }), error: ["TS: quality out of range"] },
  { name: "reverb_101", settings: settings({ reverb: 101 }), error: ["TS: reverb out of range"] },
  { name: "master_vol_101", settings: settings({ master_vol: 101 }), error: ["TS: master_vol out of range"] },
  { name: "voices_0", settings: settings({ voices: 0 }), error: ["TS: voices out of range"] },
  { name: "voices_65", settings: settings({ voices: 65 }), error: ["TS: voices out of range"] },
  { name: "waves_17", settings: settings({ waves: Array(17).fill({ Harmonics: [1] }) }), error: ["TS: too many waves"] },
  { name: "harmonics_0", settings: settings({ waves: [{ Harmonics: [1] }, { Harmonics: [] }] }), error: ["TS: harmonics length", 1] },
  { name: "harmonics_65", settings: settings({ waves: [{ Harmonics: Array(65).fill(1) }] }), error: ["TS: harmonics length", 0] },
  { name: "samples_1", settings: settings({ waves: [{ Samples: [0, 0] }, { Harmonics: [1] }, { Samples: [0] }] }), error: ["TS: samples length", 2] },
  { name: "samples_257", settings: settings({ waves: [{ Samples: Array(257).fill(0) }] }), error: ["TS: samples length", 0] },
  { name: "waves_16_valid", settings: settings({ waves: [...Array(15).fill({ Harmonics: Array(64).fill(1) }), { Samples: Array(256).fill(-1) }] }), error: ["TS: custom wave unsupported"] },
  { name: "timbres_33", settings: settings({ timbres: Array.from({ length: 33 }, (_, i) => ({ drum: false, slot: i, operators: [op({})] })) }), error: ["TS: too many timbres"] },
  // Timbre checks (9-13).
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
  // Routing (14-16).
  { name: "route_19", settings: routeAt(8, 19), error: ["TS: route out of range", 0, 7] },
  { name: "route_255", settings: routeAt(1, 255), error: ["TS: route out of range", 0, 0] },
  { name: "fm_on_first_operator", settings: routeAt(1, 1), error: ["TS: FM target not earlier", 0, 0] },
  { name: "fm_on_itself", settings: routeAt(2, 2), error: ["TS: FM target not earlier", 0, 1] },
  { name: "fm_on_later", settings: routeAt(3, 10), error: ["TS: FM target not earlier", 0, 2] },
  { name: "am_on_first_operator", settings: routeAt(1, 11), error: ["TS: AM target not earlier", 0, 0] },
  { name: "am_on_itself", settings: routeAt(2, 12), error: ["TS: AM target not earlier", 0, 1] },
  { name: "am_route_18_at_8", settings: routeAt(8, 18), error: ["TS: AM target not earlier", 0, 7] },
  // Custom wave (17).
  { name: "custom_wave", settings: one({ wave: { Custom: 0 } }), error: ["TS: custom wave unsupported", 0, 0] },
  // Field ranges (19-29).
  { name: "volume_max_plus_1", settings: one({ volume: 1000001 }), error: ["TS: volume out of range", 0, 0] },
  { name: "ratio_max_plus_1", settings: one({ ratio: 640001 }), error: ["TS: ratio out of range", 0, 0] },
  { name: "offset_hz_max_plus_1", settings: one({ offset_hz: 200000001 }), error: ["TS: offset_hz out of range", 0, 0] },
  { name: "offset_hz_min_minus_1", settings: one({ offset_hz: -200000001 }), error: ["TS: offset_hz out of range", 0, 0] },
  { name: "offset_hz_i32_min", settings: one({ offset_hz: -2147483648 }), error: ["TS: offset_hz out of range", 0, 0] },
  { name: "attack_max_plus_1", settings: one({ attack: 200001 }), error: ["TS: attack out of range", 0, 0] },
  { name: "hold_max_plus_1", settings: one({ hold: 200001 }), error: ["TS: hold out of range", 0, 0] },
  { name: "decay_max_plus_1", settings: one({ decay: 200001 }), error: ["TS: decay out of range", 0, 0] },
  { name: "sustain_max_plus_1", settings: one({ sustain: 1000001 }), error: ["TS: sustain out of range", 0, 0] },
  { name: "release_max_plus_1", settings: one({ release: 200001 }), error: ["TS: release out of range", 0, 0] },
  { name: "pitch_ratio_max_plus_1", settings: one({ pitch_ratio: 160001 }), error: ["TS: pitch_ratio out of range", 0, 0] },
  { name: "pitch_time_max_plus_1", settings: one({ pitch_time: 200001 }), error: ["TS: pitch_time out of range", 0, 0] },
  { name: "key_scale_max_plus_1", settings: one({ key_scale: 80001 }), error: ["TS: key_scale out of range", 0, 0] },
  { name: "key_scale_min_minus_1", settings: one({ key_scale: -80001 }), error: ["TS: key_scale out of range", 0, 0] },
  { name: "u32_max_volume", settings: one({ volume: 4294967295 }), error: ["TS: volume out of range", 0, 0] },
  // Filter (30).
  { name: "filter", settings: one({ filter: { kind: "LowPass", cutoff: 10000000, key_track: false, q: 7071 } }), error: ["TS: filter unsupported", 0, 0] },
  // Length (31): valid fields, one byte over the cap.
  { name: "max_length_plus_1", settings: filledTo(8193), error: ["TS: settings too long"] },
  // Check order: the first failing check wins.
  { name: "order_quality_before_reverb", settings: settings({ quality: 2, reverb: 101 }), error: ["TS: quality out of range"] },
  { name: "order_voices_before_waves", settings: settings({ voices: 0, waves: [{ Harmonics: [] }] }), error: ["TS: voices out of range"] },
  { name: "order_wave_length_before_v1_gate", settings: settings({ waves: [{ Harmonics: [1] }, { Samples: [] }] }), error: ["TS: samples length", 1] },
  {
    name: "order_v1_wave_gate_before_timbres",
    settings: settings({ waves: [{ Harmonics: [1] }], timbres: [{ drum: false, slot: 200, operators: [] }] }),
    error: ["TS: custom wave unsupported"],
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
    settings: settings({ timbres: [{ drum: false, slot: 5, operators: [op({}), op({ volume: 1000001 })] }, { drum: false, slot: 200, operators: [op({})] }] }),
    error: ["TS: volume out of range", 0, 1],
  },
  {
    name: "order_operator_0_before_operator_1",
    settings: settings({ timbres: [{ drum: false, slot: 5, operators: [op({ key_scale: 80001 }), op({ route: 9 })] }] }),
    error: ["TS: key_scale out of range", 0, 0],
  },
  { name: "order_route_before_wave", settings: one({ route: 1, wave: { Custom: 0 } }), error: ["TS: FM target not earlier", 0, 0] },
  { name: "order_custom_before_fields", settings: one({ wave: { Custom: 0 }, volume: 1000001 }), error: ["TS: custom wave unsupported", 0, 0] },
  { name: "order_volume_before_ratio", settings: one({ volume: 1000001, ratio: 640001 }), error: ["TS: volume out of range", 0, 0] },
  { name: "order_key_scale_before_filter", settings: one({ key_scale: -80001, filter: { kind: "LowPass", cutoff: 1, key_track: false, q: 1 } }), error: ["TS: key_scale out of range", 0, 0] },
];
