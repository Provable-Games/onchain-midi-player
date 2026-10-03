// @ts-check
/**
 * Reference SETTINGS encoder (Node and tooling; not part of the page). Mirrors `encode` in
 * `src/settings.cairo` byte for byte: the full v1 grammar, including custom waves and filters,
 * which `validateSettings` rejects until issues #2 and #3. Checks that every value fits its
 * Cairo type (what the Cairo type system guarantees) but not the ranges; call `validateSettings`
 * first. Throws `SettingsError('TS: settings too long')` past `MAX_SETTINGS_LEN` bytes.
 */
import {
  FILTER_KINDS, OPERATOR_FIELDS, SETTINGS_FORMAT_VERSION, SettingsError, TYPE_BOUNDS, WAVEFORMS,
} from "./settings.js";

/** Maximum length of SETTINGS, in bytes (check 31 of src/settings.cairo). */
export const MAX_SETTINGS_LEN = 8192;

/**
 * @param {unknown} v
 * @param {keyof typeof TYPE_BOUNDS} type
 * @param {string} what
 */
function int(v, type, what) {
  const [lo, hi] = TYPE_BOUNDS[type];
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) {
    throw new TypeError(what + " must be a " + type + ", got " + JSON.stringify(v));
  }
  return String(v); // canonical: no leading zeros; -0 is not an integer value here
}

/**
 * @param {unknown} v
 * @param {string} what
 */
function bool(v, what) {
  if (typeof v !== "boolean") throw new TypeError(what + " must be a boolean");
  return v ? "1" : "0";
}

/**
 * @param {import("./settings.js").SynthSettings} s
 * @param {{limit?: number}} [options] `limit` overrides the length cap (tooling only)
 * @returns {string}
 */
export function encodeSettings(s, { limit = MAX_SETTINGS_LEN } = {}) {
  /** @type {string[]} */
  const out = [String(SETTINGS_FORMAT_VERSION)];
  out.push(int(s.quality, "u8", "quality"), int(s.reverb, "u8", "reverb"),
    int(s.master_vol, "u8", "master_vol"), int(s.voices, "u8", "voices"));
  out.push(int(s.waves.length, "u32", "waves.length"));
  s.waves.forEach((w, i) => {
    if ("Harmonics" in w) {
      out.push("0", String(w.Harmonics.length), ...w.Harmonics.map((x) => int(x, "u16", `waves[${i}]`)));
    } else if ("Samples" in w) {
      out.push("1", String(w.Samples.length), ...w.Samples.map((x) => int(x, "i8", `waves[${i}]`)));
    } else throw new TypeError(`waves[${i}] must be {Harmonics} or {Samples}`);
  });
  out.push(int(s.timbres.length, "u32", "timbres.length"));
  s.timbres.forEach((t, ti) => {
    out.push(bool(t.drum, `timbres[${ti}].drum`), int(t.slot, "u8", `timbres[${ti}].slot`), String(t.operators.length));
    t.operators.forEach((o, oi) => {
      const at = `timbres[${ti}].operators[${oi}]`;
      out.push(int(o.route, "u8", at + ".route"));
      if (typeof o.wave === "object") out.push("6", int(o.wave.Custom, "u8", at + ".wave.Custom"));
      else {
        const tag = WAVEFORMS.indexOf(o.wave);
        if (tag < 0) throw new TypeError(at + ".wave is not a Waveform");
        out.push(String(tag));
      }
      for (const [name, type] of OPERATOR_FIELDS) out.push(int(/** @type {any} */ (o)[name], type, at + "." + name));
      if (o.filter === null) out.push("0");
      else {
        const kind = FILTER_KINDS.indexOf(o.filter.kind);
        if (kind < 0) throw new TypeError(at + ".filter.kind is not a FilterKind");
        out.push("1", String(kind), int(o.filter.cutoff, "u32", at + ".filter.cutoff"),
          bool(o.filter.key_track, at + ".filter.key_track"), int(o.filter.q, "u32", at + ".filter.q"));
      }
    });
  });
  const text = out.join(",");
  if (text.length > limit) throw new SettingsError("TS: settings too long");
  return text;
}
