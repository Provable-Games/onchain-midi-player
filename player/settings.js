// @ts-check
/**
 * The page's SETTINGS handling: a strict parser and the TinySynth installer. This module ships in
 * the page.
 *
 * `SETTINGS` (format version 1) is the ASCII encoding of the Cairo `TinySynthSettings` value that the
 * class writes into the page, after `settings::validate` has checked it (counts, slots, routes, wave
 * indices, filters only on outputs with a cutoff and Q above 0; every other field may take any value
 * of its type). The page parses it strictly (the
 * grammar, canonical integers, Cairo type bounds, count bounds, known tags, every token consumed)
 * and installs it; it does not repeat Cairo's checks. The JS
 * reference of those checks, for tooling and the parity tests, is `player/validate.js`; the
 * reference encoder is `player/encode.js`. Shared fixtures (`tests/fixtures/settings.json`) keep
 * them byte-for-byte identical to `src/settings.cairo`.
 *
 * CSP-safe: no eval, no Function, no dynamic code; the text is parsed as data only.
 * Dependency-free plain JavaScript; runs in browsers and in Node.
 */

/** Denominator of every fixed-point field: a stored value `x` means `x / 10000`. */
const FIXED_POINT_SCALE = 10000;
export const SETTINGS_FORMAT_VERSION = 1;

// Parse bounds: the most the parser accepts of each count, read and checked before its items. They
// are the limits of the format: every slot reachable from MIDI once, every wave `Waveform::Custom(u8)`
// can index, and 8 operators. A wave's length has none: the engine's custom-wave API takes any
// non-empty table (fork #26, decision D-028 in docs/improvements/decisions.md of
// Provable-Games/webaudio-tinysynth), and every count is also checked against the tokens left, so
// a corrupt one fails at once. Cairo's caps (`settings::validate`, and its JS reference
// player/validate.js) equal these bounds today but are separate constants: a Cairo cap can change
// within them without changing the page.
/** Timbres: 128 programs and 47 drum notes, once each. */
export const PARSE_MAX_TIMBRES = 175;
/** Waves: all that `Waveform::Custom(u8)` can index. */
export const PARSE_MAX_WAVES = 256;
/** Operators per timbre (issue #1, D5). */
export const PARSE_MAX_OPERATORS = 8;

/** `Waveform` variants in declaration order: the index is the wire tag. Tag 6 is `Custom`. */
export const WAVEFORMS = ["Sine", "Square", "Sawtooth", "Triangle", "WhiteNoise", "MetallicNoise"];
/** TinySynth `w` names for the built-in waveforms, by tag. */
const TINYSYNTH_WAVES = ["sine", "square", "sawtooth", "triangle", "n0", "n1"];
/** `FilterKind` variants in declaration order. Lowercased, they are TinySynth's `fl` names. */
export const FILTER_KINDS = ["LowPass", "HighPass", "BandPass"];

/**
 * Operator fields after `route` and `wave`, in declaration order, with their Cairo type and
 * TinySynth key: `[name, type, key]`.
 * @type {Array<[string, "u32" | "i32", string]>}
 */
export const OPERATOR_FIELDS = [
  ["volume", "u32", "v"],
  ["ratio", "u32", "t"],
  ["offset_hz", "i32", "f"],
  ["attack", "u32", "a"],
  ["hold", "u32", "h"],
  ["decay", "u32", "d"],
  ["sustain", "u32", "s"],
  ["release", "u32", "r"],
  ["pitch_ratio", "u32", "p"],
  ["pitch_time", "u32", "q"],
  ["key_scale", "i32", "k"],
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
 *   waves: WaveDef[], timbres: Timbre[]}} TinySynthSettings
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
 * Decodes SETTINGS text into a `TinySynthSettings` object, following the grammar strictly: format
 * version 1, canonical integers only, every value within its Cairo type, counts read and checked
 * against the parse bounds and the tokens left before their items (so a corrupt count can never
 * make the page loop or allocate past the input), known tags only, every token consumed. Leading
 * and trailing spaces (U+0020 only) are ignored: the page's alignment padding falls inside the
 * settings block, before SETTINGS. Throws a
 * `SettingsError` on any violation; the page then fails closed (no audio, visible error).
 *
 * It does not apply Cairo's checks (`settings::validate`, whose JS reference is `validateSettings`
 * in player/validate.js): the class validates the settings before writing them.
 * A count beyond its parse bound is reported with the message of the Cairo check, which fails too.
 * @param {string} text
 * @returns {TinySynthSettings}
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
   * Reads a count and checks it before reading the items: against its bounds, then against the
   * tokens left, since every item takes at least one.
   * @param {number} max
   * @param {string} code
   * @param {number[]} [indices]
   * @param {number} [min]
   */
  const count = (max, code, indices = [], min = 0) => {
    const n = read("u32");
    if (n < min || n > max) throw new SettingsError(code, indices);
    if (n > tokens.length - pos) throw malformed();
    return n;
  };

  if (read("u32") !== SETTINGS_FORMAT_VERSION) throw malformed();
  /** @type {TinySynthSettings} */
  const s = {
    quality: read("u8"),
    reverb: read("u8"),
    master_vol: read("u8"),
    voices: read("u8"),
    waves: [],
    timbres: [],
  };
  const nWaves = count(PARSE_MAX_WAVES, "TS: too many waves");
  for (let w = 0; w < nWaves; w++) {
    const tag = read("u32");
    if (tag === 0) {
      const n = count(Infinity, "TS: harmonics length", [w], 1);
      const h = [];
      for (let i = 0; i < n; i++) h.push(read("u16"));
      s.waves.push({ Harmonics: h });
    } else if (tag === 1) {
      const n = count(Infinity, "TS: samples length", [w], 1);
      const x = [];
      for (let i = 0; i < n; i++) x.push(read("i8"));
      s.waves.push({ Samples: x });
    } else throw malformed();
  }
  const nTimbres = count(PARSE_MAX_TIMBRES, "TS: too many timbres");
  for (let t = 0; t < nTimbres; t++) {
    const drum = read("bool") === 1;
    const slot = read("u8");
    const nOps = count(PARSE_MAX_OPERATORS, "TS: too many operators", [t]);
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

/** @param {number} x */
const fx = (x) => x / FIXED_POINT_SCALE; // one IEEE division: the same double in every engine

/**
 * The name custom wave `i` of `TinySynthSettings.waves` is registered under (issue #2): `nS<i>` for
 * `Samples`, `wH<i>` for `Harmonics`. The engine's names (fork #26, D-006) start with `n` (a sample
 * wave) or `w` (a harmonic wave), then a letter or `_`: a digit there is reserved for built-ins such
 * as `n0` and `w9999`.
 * @param {WaveDef} wave
 * @param {number} i
 */
export const waveName = (wave, i) => ("Samples" in wave ? "nS" : "wH") + i;

/**
 * Registers every custom wave with the engine, under `waveName`. `Samples`: one cycle, each `i8`
 * sample `s` as `s / 128` (-128 is -1.0, 127 is 0.9921875), with `setSampleWave`. `Harmonics`: element
 * `i` is harmonic `i + 1`, as `imag[i + 1]` of `setHarmonicWave` with `imag[0]` (DC) and `real` all
 * zero; the browser normalizes the peak, so the scale does not matter. Registering a name again
 * replaces it, and the registry survives `setQuality()`.
 * @param {any} synth
 * @param {WaveDef[]} waves
 */
export function registerWaves(synth, waves) {
  waves.forEach((w, i) => {
    if ("Samples" in w) synth.setSampleWave(waveName(w, i), w.Samples.map((v) => v / 128));
    else {
      const imag = [0].concat(w.Harmonics);
      synth.setHarmonicWave(waveName(w, i), imag.map(() => 0), imag);
    }
  });
}

/**
 * Converts a timbre's operators to TinySynth's `setTimbre` format: a built-in waveform by its
 * TinySynth name, `Custom(i)` by the name wave `i` of `waves` is registered under. A filter (issue
 * #3) becomes the engine's operator filter fields (fork #27): `fl` the kind (`lowpass`, `highpass`,
 * `bandpass`), `ff` the cutoff and `fq` the Q (both fixed point), `fk` 1 for a key-tracked cutoff,
 * else 0. An operator without a filter gets none of these keys, so the engine builds no filter node
 * and plays it as before. Builds fresh objects every time.
 * @param {Timbre} timbre
 * @param {WaveDef[]} [waves]
 */
export function toTinySynthOps(timbre, waves = []) {
  return timbre.operators.map((o) => {
    const w = o.wave;
    /** @type {Record<string, any>} */
    const p = { g: o.route, w: typeof w == "object" ? waveName(waves[w.Custom], w.Custom) : TINYSYNTH_WAVES[WAVEFORMS.indexOf(w)] };
    for (const [name, , key] of OPERATOR_FIELDS) p[key] = fx(/** @type {any} */ (o)[name]);
    const f = o.filter;
    if (f) Object.assign(p, { fl: f.kind.toLowerCase(), ff: fx(f.cutoff), fq: fx(f.q), fk: f.key_track ? 1 : 0 });
    return p;
  });
}

/**
 * Constructs TinySynth for these settings. `useReverb` must be a constructor option: TinySynth
 * reads it only when its AudioContext is set up, inside the constructor.
 * @param {any} WebAudioTinySynth the engine's constructor
 * @param {TinySynthSettings} s
 */
export function createSynth(WebAudioTinySynth, s) {
  const synth = new WebAudioTinySynth({ autoResume: false, quality: s.quality, useReverb: s.reverb > 0 ? 1 : 0, voices: s.voices });
  installSettings(synth, s);
  return synth;
}

/**
 * Applies settings to a constructed TinySynth: the custom waves (registered before any timbre
 * names them), quality (which resets programs 0–127 and drums 35–81 to the built-ins, but keeps the
 * waves), engine settings, then every custom timbre in order, filters included. Idempotent; call it
 * again after anything that changes the quality.
 * @param {any} synth
 * @param {TinySynthSettings} s
 */
export function installSettings(synth, s) {
  registerWaves(synth, s.waves);
  synth.setQuality(s.quality);
  synth.setMasterVol(s.master_vol / 100);
  synth.setReverbLev(s.reverb / 100); // convolver gain = reverbLev * 8; no convolver when reverb == 0
  synth.setVoices(s.voices);
  for (const t of s.timbres) synth.setTimbre(t.drum ? 1 : 0, t.slot, toTinySynthOps(t, s.waves));
}
