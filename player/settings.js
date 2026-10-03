// @ts-check
/**
 * Player-side SETTINGS handling: strict parser, validator and TinySynth installer.
 *
 * `SETTINGS` (format version 1) is the ASCII encoding of the Cairo `SynthSettings` value that the
 * class writes into the page. The format and the checks are specified in issue #1 and in
 * `src/settings.cairo`; this module mirrors that file check for check, with the same messages,
 * and `player/encode.js` mirrors its encoder. Shared fixtures (`tests/fixtures/settings.json`)
 * keep them byte-for-byte identical.
 *
 * CSP-safe: no eval, no Function, no dynamic code; the text is parsed as data only.
 * Dependency-free plain JavaScript; runs in browsers and in Node.
 */

// Limits, as in src/settings.cairo. Only what other modules need is exported, so a minifier can
// inline the rest (this module ships in the page).
/** Denominator of every fixed-point field: a stored value `x` means `x / 10000`. */
const FIXED_POINT_SCALE = 10000;
export const SETTINGS_FORMAT_VERSION = 1;
const MAX_WAVES = 16;
const MAX_TIMBRES = 32;
const MAX_OPERATORS = 8;
const MAX_HARMONICS = 64;
const MIN_SAMPLES = 2;
const MAX_SAMPLES = 256;
const MAX_ROUTE = 10 + MAX_OPERATORS;
const MAX_TIME = 200000;

/** `Waveform` variants in declaration order: the index is the wire tag. Tag 6 is `Custom`. */
export const WAVEFORMS = ["Sine", "Square", "Sawtooth", "Triangle", "WhiteNoise", "MetallicNoise"];
/** TinySynth `w` names for the built-in waveforms, by tag. */
const TINYSYNTH_WAVES = ["sine", "square", "sawtooth", "triangle", "n0", "n1"];
/** `FilterKind` variants in declaration order. */
export const FILTER_KINDS = ["LowPass", "HighPass", "BandPass"];

/**
 * Operator fields after `route` and `wave`, in declaration order, with their range checks and
 * TinySynth key: `[name, type, min, max, key]`; min and max are the validation bounds.
 * @type {Array<[string, "u32" | "i32", number, number, string]>}
 */
export const OPERATOR_FIELDS = [
  ["volume", "u32", 0, 1000000, "v"],
  ["ratio", "u32", 0, 640000, "t"],
  ["offset_hz", "i32", -200000000, 200000000, "f"],
  ["attack", "u32", 0, MAX_TIME, "a"],
  ["hold", "u32", 0, MAX_TIME, "h"],
  ["decay", "u32", 0, MAX_TIME, "d"],
  ["sustain", "u32", 0, 1000000, "s"],
  ["release", "u32", 0, MAX_TIME, "r"],
  ["pitch_ratio", "u32", 0, 160000, "p"],
  ["pitch_time", "u32", 0, MAX_TIME, "q"],
  ["key_scale", "i32", -80000, 80000, "k"],
];

/** Integer type bounds, as the Cairo types enforce them. */
export const TYPE_BOUNDS = {
  bool: [0, 1],
  u8: [0, 255],
  i8: [-128, 127],
  u16: [0, 65535],
  u32: [0, 4294967295],
  i32: [-2147483648, 2147483647],
};

/**
 * @typedef {"Sine" | "Square" | "Sawtooth" | "Triangle" | "WhiteNoise" | "MetallicNoise" | {Custom: number}} Waveform
 * @typedef {{Harmonics: number[]} | {Samples: number[]}} WaveDef
 * @typedef {{kind: "LowPass" | "HighPass" | "BandPass", cutoff: number, key_track: boolean, q: number}} Filter
 * @typedef {{route: number, wave: Waveform, volume: number, ratio: number, offset_hz: number,
 *   attack: number, hold: number, decay: number, sustain: number, release: number,
 *   pitch_ratio: number, pitch_time: number, key_scale: number, filter: Filter | null}} Operator
 * @typedef {{drum: boolean, slot: number, operators: Operator[]}} Timbre
 * @typedef {{quality: number, reverb: number, master_vol: number, voices: number,
 *   waves: WaveDef[], timbres: Timbre[]}} SynthSettings
 */

/**
 * A rejected SETTINGS value. `code` is the Cairo revert message (`'TS: ...'`) for a failed check,
 * or `'malformed'` for text that does not follow the grammar; `indices` are the extra panic felts
 * of the Cairo revert (0-based wave, timbre or timbre and operator index).
 */
export class SettingsError extends Error {
  /**
   * @param {string} code
   * @param {number[]} [indices]
   * @param {string} [detail]
   */
  constructor(code, indices = [], detail = "") {
    super("settings: " + code + (indices.length ? " (" + indices.join(", ") + ")" : "") + (detail ? ": " + detail : ""));
    this.name = "SettingsError";
    this.code = code;
    this.indices = indices;
  }
}

const CANONICAL = /^(0|-?[1-9][0-9]*)$/;

/**
 * Decodes SETTINGS text into a `SynthSettings` object, following the grammar strictly: canonical
 * integers only, every value within its Cairo type, counts read and bounds-checked before their
 * items, every token consumed. Leading and trailing spaces (U+0020 only) are ignored: the page's
 * alignment padding falls inside the settings block, before SETTINGS. Does not apply the range
 * checks; `parseSettings` does both. A count out of bounds is reported as soon as it is read
 * (with the same message as the Cairo check), so for text that breaks several rules the reported
 * check can be an earlier one than Cairo's order would give.
 * @param {string} text
 * @returns {SynthSettings}
 */
export function decodeSettings(text) {
  const tokens = text.replace(/^ +| +$/g, "").split(",");
  let pos = 0;
  const malformed = () => new SettingsError("malformed", [], "token " + pos);
  /** @param {keyof typeof TYPE_BOUNDS} type */
  const read = (type) => {
    const tok = tokens[pos];
    if (tok === undefined) throw malformed();
    if (!CANONICAL.test(tok)) throw malformed();
    const v = Number(tok);
    const [lo, hi] = TYPE_BOUNDS[type];
    if (!(v >= lo && v <= hi)) throw malformed();
    pos++;
    return v;
  };
  /**
   * Reads a count and checks it before reading the items.
   * @param {number} max
   * @param {string} code
   * @param {number[]} [indices]
   * @param {number} [min]
   */
  const count = (max, code, indices = [], min = 0) => {
    const n = read("u32");
    if (n < min || n > max) throw new SettingsError(code, indices);
    return n;
  };

  if (read("u32") !== SETTINGS_FORMAT_VERSION) throw malformed();
  /** @type {SynthSettings} */
  const s = {
    quality: read("u8"),
    reverb: read("u8"),
    master_vol: read("u8"),
    voices: read("u8"),
    waves: [],
    timbres: [],
  };
  const nWaves = count(MAX_WAVES, "TS: too many waves");
  for (let w = 0; w < nWaves; w++) {
    const tag = read("u32");
    if (tag === 0) {
      const n = count(MAX_HARMONICS, "TS: harmonics length", [w], 1);
      const h = [];
      for (let i = 0; i < n; i++) h.push(read("u16"));
      s.waves.push({ Harmonics: h });
    } else if (tag === 1) {
      const n = count(MAX_SAMPLES, "TS: samples length", [w], MIN_SAMPLES);
      const x = [];
      for (let i = 0; i < n; i++) x.push(read("i8"));
      s.waves.push({ Samples: x });
    } else throw malformed();
  }
  const nTimbres = count(MAX_TIMBRES, "TS: too many timbres");
  for (let t = 0; t < nTimbres; t++) {
    const drum = read("bool") === 1;
    const slot = read("u8");
    // An empty timbre decodes and then fails check 12 ('TS: no operators') in validateSettings.
    const nOps = count(MAX_OPERATORS, "TS: too many operators", [t]);
    /** @type {Operator[]} */
    const operators = [];
    for (let o = 0; o < nOps; o++) {
      const route = read("u8");
      const tag = read("u32");
      /** @type {Waveform} */
      let wave;
      if (tag < WAVEFORMS.length) wave = /** @type {Waveform} */ (WAVEFORMS[tag]);
      else if (tag === 6) wave = { Custom: read("u8") };
      else throw malformed();
      /** @type {Record<string, any>} */
      const op = { route, wave };
      for (const [name, type] of OPERATOR_FIELDS) op[name] = read(type);
      const flag = read("bool");
      if (flag) {
        const kind = read("u32");
        if (kind >= FILTER_KINDS.length) throw malformed();
        op.filter = { kind: FILTER_KINDS[kind], cutoff: read("u32"), key_track: read("bool") === 1, q: read("u32") };
      } else op.filter = null;
      operators.push(/** @type {Operator} */ (op));
    }
    s.timbres.push({ drum, slot, operators });
  }
  if (pos !== tokens.length) throw malformed();
  return s;
}

/**
 * Applies checks 1–30 of `src/settings.cairo`, in the same order and with the same messages and
 * indices, and throws a `SettingsError` on the first failure. Check 31 (length) belongs to the
 * encoder. `customWaves` lifts the issue #2 gate (checks 7 and 17); it is false in v1.
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
      for (const [name, , lo, hi] of OPERATOR_FIELDS) {
        const v = /** @type {Record<string, any>} */ (op)[name];
        check(v >= lo && v <= hi, range(name), at);
      }
      check(op.filter === null, "TS: filter unsupported", at);
    });
  });
  return s;
}

/**
 * Decodes and validates SETTINGS text. Throws a `SettingsError` on any failure; the player must
 * then fail closed (no audio, visible error).
 * @param {string} text
 * @returns {SynthSettings}
 */
export function parseSettings(text) {
  return validateSettings(decodeSettings(text));
}

/** @param {number} x */
const fx = (x) => x / FIXED_POINT_SCALE; // one IEEE division: the same double in every engine

/**
 * Converts a timbre's operators to TinySynth's `setTimbre` format. Builds fresh objects every
 * time, because `setTimbre` fills in defaults by mutating them.
 * @param {Timbre} timbre
 */
export function toTinySynthOps(timbre) {
  return timbre.operators.map((o) => {
    if (typeof o.wave === "object") throw new SettingsError("TS: custom wave unsupported");
    /** @type {Record<string, any>} */
    const p = { g: o.route, w: TINYSYNTH_WAVES[WAVEFORMS.indexOf(o.wave)] };
    for (const [name, , , , key] of OPERATOR_FIELDS) p[key] = fx(/** @type {any} */ (o)[name]);
    return p;
  });
}

/**
 * Constructs TinySynth for these settings. `useReverb` must be a constructor option: TinySynth
 * reads it only when its AudioContext is set up, inside the constructor.
 * @param {any} WebAudioTinySynth the engine's constructor
 * @param {SynthSettings} s
 */
export function createSynth(WebAudioTinySynth, s) {
  const synth = new WebAudioTinySynth({ quality: s.quality, useReverb: s.reverb > 0 ? 1 : 0, voices: s.voices });
  installSettings(synth, s);
  return synth;
}

/**
 * Applies settings to a constructed TinySynth: quality (which resets programs 0–127 and drums
 * 35–81 to the built-ins), engine settings, custom waves, then every custom timbre in order.
 * Idempotent; call it again after anything that changes the quality.
 * @param {any} synth
 * @param {SynthSettings} s
 */
export function installSettings(synth, s) {
  synth.setQuality(s.quality);
  synth.setMasterVol(s.master_vol / 100);
  synth.setReverbLev(s.reverb / 100); // convolver gain = reverbLev * 8; no convolver when reverb == 0
  synth.setVoices(s.voices);
  if (s.waves.length) throw new SettingsError("TS: custom wave unsupported"); // issue #2
  for (const t of s.timbres) synth.setTimbre(t.drum ? 1 : 0, t.slot, toTinySynthOps(t));
}
