// @ts-nocheck
// Independent SMF intent/state oracle for certification. This file deliberately imports neither
// player/player.js nor TinySynth. Its expected events, tempo map, state and pitch come from MIDI and
// the manifest's settings bytes alone.

export const ORACLE_VERSION = 1;
const DEFAULT_TEMPO_US = 500000;
const MIN_LOOP_SECONDS = 0.05;
const MAX_TEXT_BYTES = 4096;

/** @param {string} code @param {string} message @param {Record<string, unknown>} [details] */
export class MidiOracleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MidiOracleError";
    this.code = code;
    this.details = details;
  }
}

/** @param {Uint8Array} bytes */
function parseSmf(bytes) {
  let pos = 0;
  const fail = (code, message) => { throw new MidiOracleError(code, message, { byte: pos }); };
  const byte = () => {
    if (pos >= bytes.length) fail("midi-invalid", "truncated Standard MIDI File");
    return bytes[pos++];
  };
  const u16 = () => (byte() << 8) | byte();
  const u32 = () => (u16() * 65536) + u16();
  const text = (n) => {
    if (n > bytes.length - pos) fail("midi-invalid", "chunk runs past end of file");
    const out = bytes.subarray(pos, pos + n);
    pos += n;
    return out;
  };
  const tag = () => String.fromCharCode(byte(), byte(), byte(), byte());
  const vlq = () => {
    let value = 0;
    for (let count = 0; count < 4; count++) {
      const b = byte();
      value = value * 128 + (b & 127);
      if (b < 128) return value;
    }
    fail("midi-invalid", "variable-length value exceeds four bytes");
  };

  if (tag() !== "MThd" || u32() !== 6) fail("midi-invalid", "bad MIDI header");
  const format = u16();
  const trackCount = u16();
  const division = u16();
  if (format !== 0 && format !== 1) fail("midi-unsupported", "only SMF format 0 and 1 are supported");
  if (!trackCount || (format === 0 && trackCount !== 1)) fail("midi-invalid", "invalid track count");
  if (!division || (division & 0x8000)) fail("midi-unsupported", "SMPTE and zero division are unsupported");

  /** @type {Array<Array<Record<string, any>>>} */
  const tracks = [];
  let maxTick = 0;
  for (let track = 0; track < trackCount; track++) {
    if (tag() !== "MTrk") fail("midi-invalid", "expected an MTrk chunk");
    const length = u32();
    const end = pos + length;
    if (end > bytes.length) fail("midi-invalid", "MTrk chunk runs past end of file");
    let tick = 0;
    let running = 0;
    let index = 0;
    let ended = false;
    /** @type {Array<Record<string, any>>} */
    const events = [];
    while (pos < end) {
      tick += vlq();
      let status = byte();
      if (status < 0x80) {
        if (!running) fail("midi-invalid", "running status without a channel status");
        pos--;
        status = running;
      }
      const event = { track, index: index++, tick, kind: "ignored", status, channel: null, data: [] };
      if (status === 0xff) {
        const type = byte();
        const n = vlq();
        const data = text(n);
        event.kind = type === 0x2f ? "eot" : type === 0x51 ? "tempo" : "meta";
        event.metaType = type;
        event.data = [...data];
        if (type === 0x2f) {
          if (n || pos !== end) fail("midi-invalid", "End-of-Track is not the final track event");
          ended = true;
        } else if (type === 0x51 && (n !== 3 || !(data[0] | data[1] | data[2]))) {
          fail("midi-invalid", "invalid tempo event");
        } else if ([1, 2, 3, 4, 9].includes(type) && n > MAX_TEXT_BYTES) {
          fail("midi-invalid", "text event exceeds the player limit");
        }
        running = 0;
      } else if (status === 0xf0) {
        const n = vlq();
        const data = text(n);
        if (!n || data[data.length - 1] !== 0xf7) fail("midi-invalid", "SysEx must be complete in one F0 event");
        event.kind = "sysex";
        event.data = [...data];
        running = 0;
      } else if (status === 0xf7 || status >= 0xf0) {
        fail("midi-unsupported", "system status and F7 escape events are outside the checked domain");
      } else {
        running = status;
        event.channel = status & 15;
        const type = status & 0xf0;
        const n = type === 0xc0 || type === 0xd0 ? 1 : 2;
        const data = Array.from(text(n));
        if (data.some((x) => x > 127)) fail("midi-invalid", "channel data byte exceeds 127");
        event.data = data;
        if (type === 0x80 || (type === 0x90 && data[1] === 0)) event.kind = "noteOff";
        else if (type === 0x90) event.kind = "noteOn";
        else if (type === 0xb0) event.kind = "control";
        else if (type === 0xc0) event.kind = "program";
        else if (type === 0xe0) event.kind = "bend";
        else if (type === 0xa0 || type === 0xd0) event.kind = "ignoredChannel";
      }
      events.push(event);
      if (ended) break;
    }
    if (!ended || pos !== end) fail("midi-invalid", "track is truncated or has trailing bytes after End-of-Track");
    maxTick = Math.max(maxTick, tick);
    tracks.push(events);
  }
  if (pos !== bytes.length) fail("midi-invalid", "bytes trail the final track");
  const events = tracks.flat().sort((a, b) => a.tick - b.tick || a.track - b.track || a.index - b.index);
  let atTick = 0;
  let atSeconds = 0;
  let tempo = DEFAULT_TEMPO_US;
  for (const event of events) {
    atSeconds += ((event.tick - atTick) * tempo) / division / 1000000;
    event.seconds = atSeconds;
    atTick = event.tick;
    if (event.kind === "tempo") tempo = (event.data[0] << 16) | (event.data[1] << 8) | event.data[2];
  }
  const loopSeconds = atSeconds + ((maxTick - atTick) * tempo) / division / 1000000;
  if (!(loopSeconds >= MIN_LOOP_SECONDS)) fail("midi-invalid", "loop is shorter than 50 ms");
  return { format, trackCount, division, maxTick, loopSeconds, tracks, events };
}

/** @param {number} key */
export function equalTemperamentHz(key) {
  return 440 * 2 ** ((key - 69) / 12);
}

const initialChannel = () => ({
  program: 0, volume: 100, pan: 64, expression: 127, modulation: 0, sustain: 0,
  bend: 8192, bendRangeSemitones: 2, bendRangeCents: 0, bendRange14: 256, coarse: 0, fine: 0,
  rpnMsb: 127, rpnLsb: 127, rpnKind: "rpn", tuning14: 8192, rpnInitialized: false,
});

/** @param {number} channel @param {number} key */
const noteKey = (channel, key) => channel + ":" + key;

/** @param {Record<string, any>} settings @param {number} channel @param {number} key @param {number} program */
function selectedTimbre(settings, channel, key, program) {
  return settings.timbres.find((t) => channel === 9 ? t.drum && t.slot === key : !t.drum && t.slot === program) || null;
}

/** @param {Record<string, any>} state @param {number} channel @param {number} key @param {{fine: number, coarse: number}} master */
function bendCents(state, channel) {
  const ch = state.channels[channel];
  return ((ch.bend - 8192) / 8192) * (ch.bendRangeSemitones * 100 + ch.bendRangeCents);
}

function legacyEngineBendCents(state, channel) {
  const ch = state.channels[channel];
  return ((ch.bend - 8192) / 8192) * (ch.bendRange14 * 100 / 127);
}

/** Root note frequency before the oscillator/buffer's AudioParam detune input. */
function basePitchHz(state, channel, key, master) {
  const ch = state.channels[channel];
  const semitones = key - 69 + master.coarse + master.fine + ch.coarse + ch.fine;
  return 440 * 2 ** (semitones / 12);
}

function pitchHz(state, channel, key, master) {
  return basePitchHz(state, channel, key, master) * 2 ** (bendCents(state, channel) / 1200);
}

const FIXED = 10000;
const RELEASE_RATIO = 3.5;
const NOISE_WAVES = new Set(["WhiteNoise", "MetallicNoise"]);
const BUILTIN_OSCILLATORS = new Set(["Sine", "Square", "Sawtooth", "Triangle"]);
// These controllers have no effect in the pinned TinySynth send() switch. Keep their no-op
// classification explicit; their presence is still incomplete because their musical intent is not
// represented by this oracle.
const ENGINE_NOOP_CONTROLLERS = new Set(Array.from({ length: 120 }, (_, cc) => cc)
  .filter((cc) => ![1, 6, 7, 10, 11, 38, 64, 98, 99, 100, 101].includes(cc)));
const f32 = (value) => Number.isFinite(value) && Number.isFinite(Math.fround(value));
const fixed = (value) => value / FIXED;

/** @param {Record<string, any>} op @param {Record<string, any>} settings @param {Record<string, string>} waveIntents */
function operatorWave(op, settings, waveIntents) {
  if (typeof op.wave === "string") {
    if (NOISE_WAVES.has(op.wave)) return { name: op.wave, source: "sample", intent: "unpitched", sampleLength: null, homeHz: 440 };
    if (BUILTIN_OSCILLATORS.has(op.wave)) return { name: op.wave, source: "oscillator", intent: "pitched", sampleLength: null, homeHz: null };
    return { name: op.wave, source: "unknown", intent: "unknown", sampleLength: null, homeHz: null };
  }
  const index = op.wave?.Custom;
  const def = Number.isInteger(index) ? settings.waves?.[index] : null;
  if (!def) return { name: `Custom(${index})`, source: "unknown", intent: "unknown", sampleLength: null, homeHz: null };
  if (Array.isArray(def.Samples)) {
    return { name: `nS${index}`, source: "sample", intent: waveIntents[String(index)] || "unknown", sampleLength: def.Samples.length, homeHz: null };
  }
  if (Array.isArray(def.Harmonics)) {
    return { name: `wH${index}`, source: "oscillator", intent: waveIntents[String(index)] || "unknown", sampleLength: null, homeHz: null };
  }
  return { name: `Custom(${index})`, source: "unknown", intent: "unknown", sampleLength: null, homeHz: null };
}

/** @param {Record<string, any>} timbre @param {Record<string, any>} settings @param {Record<string, any>} state @param {number} key @param {number} velocity @param {number} sampleRate @param {number} releaseRatio @param {Record<string, string>} waveIntents */
function operatorExpectations(timbre, settings, state, key, velocity, sampleRate, releaseRatio, waveIntents) {
  const rootHz = state.baseHz;
  /** @type {Array<Record<string, any>>} */
  const result = [];
  for (let i = 0; i < timbre.operators.length; i++) {
    const op = timbre.operators[i];
    const wave = operatorWave(op, settings, waveIntents);
    const route = op.route;
    const prior = route ? result[route > 10 ? route - 11 : route - 1] : null;
    const parentHz = route ? prior?.frequencyHz : rootHz;
    const frequencyHz = parentHz * fixed(op.ratio) + fixed(op.offset_hz);
    const homeHz = wave.source === "sample" && wave.sampleLength
      ? sampleRate / (wave.sampleLength * Math.max(1, Math.round(sampleRate / (440 * wave.sampleLength))))
      : wave.homeHz;
    const playbackRate = wave.source === "sample" && homeHz ? frequencyHz / homeHz : null;
    const parentRate = prior?.playbackRate ?? (prior?.frequencyHz ?? rootHz);
    const keyScale = 2 ** (((key - 60) / 12) * fixed(op.key_scale));
    const baseGain = route > 10 ? 1 : route ? parentRate : velocity * velocity / 16384;
    const level = baseGain * fixed(op.volume) * keyScale;
    const sustainLevel = level * fixed(op.sustain);
    const targetFrequencyHz = frequencyHz * fixed(op.pitch_ratio);
    const targetPlaybackRate = playbackRate === null ? null : playbackRate * fixed(op.pitch_ratio);
    const filterHz = op.filter && route === 0
      ? Math.min(op.filter.key_track ? rootHz * fixed(op.filter.cutoff) : fixed(op.filter.cutoff), sampleRate * 0.45)
      : null;
    const numeric = [frequencyHz, level, sustainLevel, targetFrequencyHz];
    if (filterHz !== null) numeric.push(filterHz);
    if (playbackRate !== null) numeric.push(playbackRate);
    if (targetPlaybackRate !== null) numeric.push(targetPlaybackRate);
    result.push({
      index: i, route, wave: wave.name, source: wave.source, intent: wave.intent,
      frequencyHz, homeHz, playbackRate, targetFrequencyHz, targetPlaybackRate,
      pitchEnvelope: { timeConstantSeconds: fixed(op.pitch_time), ratio: fixed(op.pitch_ratio) },
      detuneCents: state.bendCentsEffective, legacyEngineDetuneCents: state.legacyEngineBendCents, level, sustainLevel,
      attackSeconds: fixed(op.attack), holdSeconds: fixed(op.hold), decaySeconds: fixed(op.decay),
      releaseSeconds: fixed(op.release), releaseTailSeconds: fixed(op.release) * releaseRatio,
      filterHz, numericFiniteFloat32: numeric.every(f32),
    });
  }
  return result;
}

/**
 * @param {Uint8Array} bytes
 * @param {Record<string, any>} settings
 * @param {{passes?: number, eotHeldNotes?: "reject" | "carry", horizonSeconds?: number, startupAnchorSeconds?: number,
 *   schedulerIntervalSeconds?: number, sampleRate?: number, releaseRatio?: number,
 *   waveIntents?: Record<string, string>}} [options]
 */
export function analyzeMidi(bytes, settings, options = {}) {
  const passes = options.passes ?? 3;
  const eotHeldNotes = options.eotHeldNotes;
  const requestedHorizon = options.horizonSeconds;
  const requestedAnchor = options.startupAnchorSeconds;
  const requestedTimerSlack = options.schedulerIntervalSeconds;
  const requestedSampleRate = options.sampleRate;
  const requestedReleaseRatio = options.releaseRatio;
  const waveIntents = options.waveIntents || {};
  const timingValid = Number.isFinite(requestedHorizon) && requestedHorizon >= 0 && requestedHorizon <= 60 &&
    Number.isFinite(requestedAnchor) && requestedAnchor >= 0 && requestedAnchor <= 10 &&
    Number.isFinite(requestedTimerSlack) && requestedTimerSlack >= 0 && requestedTimerSlack <= 1;
  const horizonSeconds = Number.isFinite(requestedHorizon) && requestedHorizon >= 0 ? requestedHorizon : 0;
  const startupAnchorSeconds = Number.isFinite(requestedAnchor) && requestedAnchor >= 0 ? requestedAnchor : 0;
  const schedulerIntervalSeconds = Number.isFinite(requestedTimerSlack) && requestedTimerSlack >= 0 ? requestedTimerSlack : 0;
  const sampleRate = Number.isFinite(requestedSampleRate) && requestedSampleRate >= 8000 && requestedSampleRate <= 384000 ? requestedSampleRate : 44100;
  const releaseRatio = Number.isFinite(requestedReleaseRatio) && requestedReleaseRatio >= 0 && requestedReleaseRatio <= 1000 ? requestedReleaseRatio : RELEASE_RATIO;
  const parsed = parseSmf(bytes);
  /** @type {Array<Record<string, any>>} */
  const notes = [];
  /** @type {Array<Record<string, any>>} */
  const failures = [];
  /** @type {Array<Record<string, any>>} */
  const incomplete = [];
  if (!timingValid) incomplete.push({ code: "invalid-runtime-timing", message: "finite measured horizon, startup anchor and scheduler interval are required" });
  if (!(Number.isFinite(requestedSampleRate) && requestedSampleRate >= 8000 && requestedSampleRate <= 384000)) {
    incomplete.push({ code: "invalid-sample-rate", message: "sampleRate must be measured and between 8000 and 384000 Hz" });
  }
  if (!(Number.isFinite(requestedReleaseRatio) && requestedReleaseRatio >= 0 && requestedReleaseRatio <= 1000)) {
    incomplete.push({ code: "invalid-release-ratio", message: "releaseRatio must be measured and finite" });
  }
  if (!Number.isInteger(passes) || passes < 3 || passes > 16) incomplete.push({ code: "invalid-state-pass-count", message: "state pass count must be an integer from 3 through 16" });
  if (!["reject", "carry"].includes(eotHeldNotes)) incomplete.push({ code: "missing-eot-policy", message: "an explicit reject or carry End-of-Track held-note policy is required" });
  /** @type {Set<string>} */
  const changedDimensions = new Set();
  const featureKeys = new Set();
  /** @type {Map<string, number>} */
  const initializers = new Map();
  const channels = Array.from({ length: 16 }, initialChannel);
  const master = { fine: 0, coarse: 0 };
  const active = new Map();
  const markState = (dimension, event) => {
    changedDimensions.add(dimension);
    if (event.tick === 0 && !initializers.has(dimension)) initializers.set(dimension, event.index + event.track * 1000000);
  };
  const stateView = (channel, key, program) => {
    const ch = channels[channel];
    return {
      program, volume: ch.volume, pan: ch.pan, expression: ch.expression, modulation: ch.modulation,
      sustain: ch.sustain, bend: ch.bend, bendRangeSemitones: ch.bendRangeSemitones,
      bendRangeCents: ch.bendRangeCents, bendRange14: ch.bendRange14,
      coarse: ch.coarse, fine: ch.fine, masterCoarse: master.coarse, masterFine: master.fine,
      key, baseHz: basePitchHz({ channels }, channel, key, master),
      pitchHz: pitchHz({ channels }, channel, key, master), bendCentsEffective: bendCents({ channels }, channel),
      legacyEngineBendCents: legacyEngineBendCents({ channels }, channel),
    };
  };
  const currentActive = (channel, key) => active.get(noteKey(channel, key)) || [];
  const setActive = (channel, key, value) => active.set(noteKey(channel, key), value);
  const release = (note, time, event) => {
    note.offTime = time;
    note.offTick = event.tick;
    note.offEvent = { track: event.track, index: event.index };
    note.released = true;
  };
  const noteReleaseSeconds = (timbre) => {
    const first = timbre?.operators?.[0];
    return first ? fixed(first.release) * releaseRatio : 0;
  };
  const feature = (code, message, event, status = "incomplete") => {
    const key = [code, event.track, event.index].join(":");
    if (featureKeys.has(key)) return;
    featureKeys.add(key);
    const item = { code, message, tick: event.tick, track: event.track, eventIndex: event.index };
    (status === "fail" ? failures : incomplete).push(item);
  };

  const maxExpectedTailSeconds = Math.max(0, ...(settings.timbres || []).flatMap((t) => {
    const operators = t.operators || [];
    return operators.flatMap((op) => [fixed(op.release) * releaseRatio, fixed(op.decay) * releaseRatio]);
  }));
  const requiredResourcePasses = timingValid
    ? Math.max(3, Math.ceil((horizonSeconds + startupAnchorSeconds + schedulerIntervalSeconds + maxExpectedTailSeconds) / parsed.loopSeconds) + 3)
    : Math.max(3, Number.isInteger(passes) && passes >= 3 ? passes : 3);
  const MAX_RESOURCE_PASSES = 10000;
  const MAX_RESOURCE_EVENTS = 1000000;
  const resourceBoundComplete = requiredResourcePasses <= MAX_RESOURCE_PASSES && parsed.events.length * requiredResourcePasses <= MAX_RESOURCE_EVENTS;
  const analysisPasses = resourceBoundComplete ? requiredResourcePasses : 3;
  if (!resourceBoundComplete) incomplete.push({ code: "resource-analysis-bound-exceeded", message: "periodic horizon/tail demand exceeds the explicit event/pass caps", requestedPasses: requiredResourcePasses, eventCount: parsed.events.length, maxPasses: MAX_RESOURCE_PASSES, maxEvents: MAX_RESOURCE_EVENTS });
  const statePasses = Number.isInteger(passes) && passes >= 3 && passes <= 16 ? passes : 3;
  const eventsByTick = new Map();
  for (const e of parsed.events) {
    if (!eventsByTick.has(e.tick)) eventsByTick.set(e.tick, []);
    eventsByTick.get(e.tick).push(e);
  }
  let eotHoldFailureReported = false;
  for (let pass = 0; pass < analysisPasses; pass++) {
    for (const event of parsed.events) {
      const time = pass * parsed.loopSeconds + event.seconds;
      const ch = event.channel === null ? null : channels[event.channel];
      if (event.kind === "program") {
        const dim = "channel:" + event.channel + ":program";
        markState(dim, event);
        ch.program = event.data[0];
      } else if (event.kind === "control") {
        const [cc, value] = event.data;
        if (cc >= 120 && cc <= 127) {
          feature("forbidden-controller", "CC" + cc + " is forbidden by the certified playback domain", event, "fail");
          continue;
        }
        if (ENGINE_NOOP_CONTROLLERS.has(cc)) {
          feature("engine-ignored-controller", "pinned TinySynth send() explicitly ignores CC" + cc + "; musical intent is outside this oracle", event);
          continue;
        }
        if ([1, 7, 10, 11, 64, 100, 101].includes(cc)) markState("channel:" + event.channel + ":cc" + cc, event);
        if (cc === 1) {
          ch.modulation = value;
          if (value > 0) feature("nonzero-modulation-unqualified", "CC1 is tracked, but nonzero modulation needs explicit source/history and native-audio qualification", event);
        }
        else if (cc === 7) ch.volume = value;
        else if (cc === 10) ch.pan = value;
        else if (cc === 11) ch.expression = value;
        else if (cc === 64) {
          const wasDown = ch.sustain >= 64;
          ch.sustain = value;
          if (wasDown && value < 64) {
            for (const [identity, list] of active) {
              if (!identity.startsWith(event.channel + ":")) continue;
              for (let i = list.length - 1; i >= 0; i--) {
                const note = list[i];
                if (!note.pendingPedal) continue;
                release(note, time, event);
                note.pendingPedal = false;
                list.splice(i, 1);
              }
              active.set(identity, list);
            }
          }
        } else if (cc === 98 || cc === 99) {
          markState("channel:" + event.channel + ":nrpn", event);
          ch.rpnKind = "nrpn";
          feature("nrpn-selection", "NRPN selection is understood to disable RPN data entry but its musical intent is unsupported", event);
        } else if (cc === 101 || cc === 100) {
          markState("channel:" + event.channel + ":rpn", event);
          ch.rpnKind = "rpn";
          if (cc === 101) ch.rpnMsb = value;
          else ch.rpnLsb = value;
        } else if (cc === 6 || cc === 38) {
          const selected = ch.rpnKind === "rpn" ? (ch.rpnMsb << 7) | ch.rpnLsb : -1;
          if (selected === 0) {
            markState("channel:" + event.channel + ":bendRange", event);
            ch.bendRangeSemitones = cc === 6 ? value : ch.bendRangeSemitones;
            ch.bendRangeCents = cc === 38 ? Math.min(value, 99) : ch.bendRangeCents;
            ch.bendRange14 = cc === 6 ? (value << 7) | (ch.bendRange14 & 127) : (ch.bendRange14 & 0x3f80) | value;
            feature("rpn-bend-range-unqualified", "RPN 0 is parsed against normative semitone+cents intent; the pinned engine uses a distinct /127 arithmetic path requiring qualified migration", event);
          } else if (selected === 1) {
            markState("channel:" + event.channel + ":fineTuning", event);
            ch.tuning14 = cc === 6 ? (value << 7) | (ch.tuning14 & 127) : (ch.tuning14 & 0x3f80) | value;
            ch.fine = (ch.tuning14 - 8192) / 8192;
          } else if (selected === 2) {
            if (cc === 6) {
              markState("channel:" + event.channel + ":coarseTuning", event);
              ch.coarse = value - 64;
            } else {
              feature("rpn-coarse-lsb-noop", "RPN 2 CC38 is a documented TinySynth no-op", event);
            }
          } else {
            feature("unsupported-rpn", selected < 0
              ? "data entry follows NRPN or null RPN selection and has no interpreted state"
              : "RPN " + ch.rpnMsb + "/" + ch.rpnLsb + " is outside the interpreted 0, 1, 2 domain", event);
          }
        }
      } else if (event.kind === "bend") {
        markState("channel:" + event.channel + ":pitchBend", event);
        ch.bend = event.data[0] | (event.data[1] << 7);
        if (ch.bend !== 8192) feature("nonzero-pitch-bend-unqualified", "pitch bend uses normative RPN0 cents; current engine detune arithmetic is recorded separately and needs qualification", event);
        for (const note of notes) {
          if (note.channel !== event.channel || note.time > time || (note.offTime !== null && note.offTime + note.releaseSeconds < time)) continue;
          if (note.expectedOperators.some((op) => op.source === "sample")) {
            feature("held-sample-bend-unsupported", "the engine does not update already-held BufferSource playback under a later pitch-bend event", event, "fail");
          }
        }
      } else if (event.kind === "sysex") {
        const d = event.data;
        if (d[0] === 0x7f && d[2] === 0x04 && d[3] === 0x03 && d.length === 7) {
          markState("master:fineTuning", event);
          master.fine = (((d[5] << 7) | d[4]) - 8192) / 8192;
        } else if (d[0] === 0x7f && d[2] === 0x04 && d[3] === 0x04 && d.length === 7) {
          markState("master:coarseTuning", event);
          master.coarse = d[5] - 64;
        } else if (d[0] === 0x7e && d[2] === 0x09 && d[3] === 0x01 && d.length === 5) {
          // GM System On is an engine no-op; it carries no state used by this oracle.
        } else if (d[0] === 0x41 && d[2] === 0x42 && d[3] === 0x12 && d[4] === 0x40 && (d[6] & 0x7f) === 0x15) {
          feature("gs-rhythm-switch", "GS rhythm-part switching is excluded until separately certified", event, "fail");
        } else {
          feature("unsupported-sysex", "SysEx message is not covered by the versioned tuning/state model", event);
        }
      } else if (event.kind === "meta") {
        if (![0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x20, 0x21, 0x58, 0x59].includes(event.metaType)) {
          feature("unsupported-meta", "meta event 0x" + event.metaType.toString(16) + " is not in the documented no-op list", event);
        }
      } else if (event.kind === "ignoredChannel") {
        // Channel and polyphonic pressure are explicitly ignored by the pinned engine. The event
        // itself is reported so no channel message silently falls out of the interpretation.
        feature("ignored-channel-pressure", "channel/polyphonic pressure is an explicit engine no-op", event);
      } else if (event.kind === "noteOn") {
        const [key, velocity] = event.data;
        const program = ch.program;
        const timbre = selectedTimbre(settings, event.channel, key, program);
        const state = stateView(event.channel, key, program);
        const expectedOperators = timbre ? operatorExpectations(timbre, settings, state, key, velocity, sampleRate, releaseRatio, waveIntents) : [];
        const outputOps = expectedOperators.filter((op) => op.route === 0);
        const pitchIntent = event.channel === 9 ? "unpitched-percussion" :
          outputOps.some((op) => op.intent === "unknown") ? "unknown" :
          outputOps.length && outputOps.every((op) => op.intent === "unpitched") ? "unpitched-noise" : "operator-frequency-model";
        const pureSine = event.channel !== 9 && timbre?.operators?.length === 1 && outputOps.length === 1 &&
          timbre.operators[0].wave === "Sine" && timbre.operators[0].ratio === FIXED && timbre.operators[0].offset_hz === 0 &&
          timbre.operators[0].pitch_ratio === FIXED && timbre.operators[0].filter === null;
        const note = {
          id: "p" + pass + ":t" + event.track + ":e" + event.index,
          pass, track: event.track, eventIndex: event.index, tick: event.tick, time,
          channel: event.channel, key, velocity, program, drum: event.channel === 9,
          state, timbre: timbre ? timbre.slot : null, operators: expectedOperators.length,
          pitchIntent, expectedFundamentalHz: pureSine ? state.pitchHz : null,
          expectedOperators, releaseSeconds: noteReleaseSeconds(timbre),
          offTime: null, pendingPedal: false, zeroLength: false,
        };
        if (!timbre) feature("missing-timbre", "MIDI selects a program or drum without a supplied settings timbre", event);
        else if (!timbre.operators.length) feature("empty-timbre", "selected timbre has no operators", event, "fail");
        else if (!outputOps.length) feature("silent-timbre", "selected timbre has no operator routed to an audio output", event, "fail");
        for (const op of expectedOperators) {
          if (op.source === "unknown") feature("unknown-wave-source", "operator " + op.index + " does not resolve to a supported engine source", event);
          if (op.intent === "unknown") feature("unknown-custom-wave-intent", "custom wave " + op.wave + " needs an explicit pitched or unpitched intent", event);
          if (!op.numericFiniteFloat32) feature("numeric-source-out-of-range", "operator " + op.index + " has a source, envelope, or gain value that cannot be represented as finite float32", event, "fail");
        }
        const group = eventsByTick.get(event.tick) || [];
        const orderedAfter = group.some((x) => x.channel === event.channel && x.kind === "noteOff" && x.data[0] === key &&
          (x.track > event.track || (x.track === event.track && x.index > event.index)));
        const older = currentActive(event.channel, key);
        if (older.length && orderedAfter) {
          failures.push({ code: "same-tick-retrigger-order", message: "same-key note-on precedes an existing note-off after merged track ordering", tick: event.tick, track: event.track, eventIndex: event.index, channel: event.channel, key, oldNoteId: older.at(-1).id });
        } else if (older.length) {
          incomplete.push({ code: "overlapping-same-key", message: "overlapping same-key notes outside an unambiguous same-tick off-before-on boundary are not mapped to note instances", tick: event.tick, track: event.track, eventIndex: event.index, channel: event.channel, key });
        } else if (!older.length && orderedAfter) {
          note.zeroLengthCandidate = true;
        }
        const list = currentActive(event.channel, key);
        list.push(note);
        setActive(event.channel, key, list);
        notes.push(note);
      } else if (event.kind === "noteOff") {
        const [key] = event.data;
        const list = currentActive(event.channel, key);
        const note = list.at(-1);
        if (note) {
          if (ch.sustain >= 64) note.pendingPedal = true;
          else {
            release(note, time, event);
            note.zeroLength = note.tick === event.tick;
          }
          if (!note.pendingPedal) list.pop();
          setActive(event.channel, key, list);
        } else {
          feature("orphan-note-off", "note-off has no independently matched held note instance", event);
        }
      }
    }
    const heldAtEot = [...active.values()].flat().filter((note) => !note.released);
    if (heldAtEot.length && eotHeldNotes === "reject" && !eotHoldFailureReported) {
      failures.push({ code: "end-of-track-held-notes", message: heldAtEot.length + " note instance(s) remain held at a loop boundary; policy=reject", pass, noteIds: heldAtEot.map((note) => note.id) });
      eotHoldFailureReported = true;
    }
  }

  for (const dimension of changedDimensions) {
    if (!initializers.has(dimension)) {
      failures.push({ code: "missing-tick-zero-state", message: dimension + " changes in the score but has no tick-0 initializer" });
    }
  }
  for (const dimension of changedDimensions) {
    const parts = dimension.split(":");
    const scope = parts[0];
    const channel = scope === "channel" ? Number(parts[1]) : null;
    const stateName = scope === "channel" ? parts[2] : parts[1];
    const firstNoteAtZero = parsed.events.find((e) => e.tick === 0 && e.kind === "noteOn" && (channel === null || e.channel === channel));
    if (!firstNoteAtZero || !initializers.has(dimension)) continue;
    const first = parsed.events.find((e) => {
      if (e.tick !== 0 || (channel !== null && e.channel !== channel)) return false;
      if (stateName === "program") return e.kind === "program";
      if (stateName === "pitchBend") return e.kind === "bend";
      if (stateName === "fineTuning" && scope === "master") return e.kind === "sysex" && e.data[0] === 0x7f && e.data[2] === 0x04 && e.data[3] === 0x03;
      if (stateName === "coarseTuning" && scope === "master") return e.kind === "sysex" && e.data[0] === 0x7f && e.data[2] === 0x04 && e.data[3] === 0x04;
      if (["fineTuning", "coarseTuning", "bendRange"].includes(stateName)) return e.kind === "control" && (e.data[0] === 6 || e.data[0] === 38);
      if (stateName === "rpn") return e.kind === "control" && (e.data[0] === 100 || e.data[0] === 101);
      if (stateName === "nrpn") return e.kind === "control" && (e.data[0] === 98 || e.data[0] === 99);
      if (stateName.startsWith("cc")) return e.kind === "control" && e.data[0] === Number(stateName.slice(2));
      return false;
    });
    if (first && (first.track > firstNoteAtZero.track || (first.track === firstNoteAtZero.track && first.index > firstNoteAtZero.index))) {
      failures.push({ code: "late-tick-zero-state", message: dimension + " is initialized after the opening note", tick: 0, track: first.track, eventIndex: first.index });
    }
  }

  const opening = [];
  for (let pass = 0; pass < statePasses; pass++) opening.push(notes.filter((n) => n.pass === pass).sort((a, b) => a.time - b.time)[0] || null);
  if (opening.some((n) => !n)) incomplete.push({ code: "no-opening-note", message: "three-pass opening-state check needs at least one note per pass" });
  else {
    const baseline = JSON.stringify({ channel: opening[0].channel, key: opening[0].key, program: opening[0].program, state: opening[0].state, expectedFundamentalHz: opening[0].expectedFundamentalHz, expectedOperators: opening[0].expectedOperators });
    for (let pass = 1; pass < opening.length; pass++) {
      const next = JSON.stringify({ channel: opening[pass].channel, key: opening[pass].key, program: opening[pass].program, state: opening[pass].state, expectedFundamentalHz: opening[pass].expectedFundamentalHz, expectedOperators: opening[pass].expectedOperators });
      if (next !== baseline) failures.push({ code: "opening-state-drift", message: "the opening note state differs across loop passes", pass, noteId: opening[pass].id, expected: JSON.parse(baseline), actual: JSON.parse(next) });
    }
  }

  const heldAtEnd = [...active.values()].flat().filter((n) => !n.released);
  if (heldAtEnd.length && eotHeldNotes === "carry") {
    incomplete.push({ code: "unbounded-carried-notes", message: "held notes remain after the bounded periodic analysis window", noteIds: heldAtEnd.map((n) => n.id), resourcePasses: analysisPasses });
  }

  const voiceLimit = settings.voices;
  const allocatorIntervals = [];
  const operatorIntervals = [];
  const melodicIntervals = [];
  const percussionIntervals = [];
  const transientDrumHeadroom = [];
  const maxOperatorTail = Math.max(0, ...(settings.timbres || []).flatMap((t) => (t.operators || []).map((op) => fixed(op.release) * releaseRatio)));
  let tailMismatchCount = 0;
  for (const note of notes) {
    if (!note.expectedOperators.length) continue;
    const scheduledAt = Math.max(0, startupAnchorSeconds + note.time - horizonSeconds);
    note.scheduledAt = scheduledAt;
    const released = note.offTime !== null;
    const firstTail = note.releaseSeconds;
    const allocatorEnd = released ? startupAnchorSeconds + note.offTime + firstTail + schedulerIntervalSeconds : Infinity;
    note.allocatorExpectedEnd = allocatorEnd;
    if (!note.drum) allocatorIntervals.push({ start: scheduledAt, end: allocatorEnd, noteId: note.id, count: 1 });
    const noteOperatorStarts = note.expectedOperators.length;
    for (const op of note.expectedOperators) {
      const naturalTail = note.drum
        ? note.expectedOperators[0].decaySeconds * releaseRatio
        : op.releaseTailSeconds;
      const sourceEnd = note.drum
        ? startupAnchorSeconds + note.time + naturalTail
        : released ? startupAnchorSeconds + note.offTime + op.releaseTailSeconds : Infinity;
      const engineEnd = note.drum ? sourceEnd : allocatorEnd;
      operatorIntervals.push({ start: scheduledAt, end: sourceEnd, noteId: note.id, operator: op.index, drum: note.drum, count: 1 });
      (note.drum ? percussionIntervals : melodicIntervals).push({ start: scheduledAt, end: sourceEnd, noteId: note.id, operator: op.index, count: 1 });
      op.naturalTailEnd = sourceEnd;
      op.engineAllocatorStopAt = engineEnd;
      if (!note.drum && released && op.releaseTailSeconds > firstTail + 1e-9) {
        tailMismatchCount++;
        failures.push({ code: "operator-tail-exceeds-allocator", message: "operator " + op.index + " has a release tail longer than the voice allocator's operator-0 lifetime", noteId: note.id, operatorReleaseTailSeconds: op.releaseTailSeconds, allocatorReleaseTailSeconds: firstTail, requiredDecision: "versioned-legacy-tail-acceptance" });
      }
    }
    note.operatorSourceCount = noteOperatorStarts;
    if (note.drum) {
      const at = scheduledAt;
      const live = allocatorIntervals.filter((interval) => interval.start <= at && interval.end >= at);
      transientDrumHeadroom.push({ noteId: note.id, at, existingMelodicVoices: live.length, voices: voiceLimit });
      if (Number.isInteger(voiceLimit) && live.length >= voiceLimit) {
        failures.push({ code: "percussion-transient-voice-steal", message: "the engine calls _limitVoices for this one-shot drum and can prune a melodic voice when no allocator slot remains", noteId: note.id, existingMelodicVoices: live.length, voices: voiceLimit, at });
      }
    }
  }

  /** @param {Array<{start: number, end: number, count: number}>} intervals */
  const peak = (intervals) => {
    const points = [];
    for (const interval of intervals) {
      points.push({ at: interval.start, delta: interval.count, phase: 0 });
      if (Number.isFinite(interval.end)) points.push({ at: interval.end, delta: -interval.count, phase: 1 });
    }
    points.sort((a, b) => a.at - b.at || a.phase - b.phase);
    let live = 0, maximum = 0, at = 0;
    for (const point of points) {
      live += point.delta;
      if (live > maximum) { maximum = live; at = point.at; }
    }
    return { maximum, at, points };
  };
  const allocatorPeak = peak(allocatorIntervals);
  const operatorPeak = peak(operatorIntervals);
  const melodicPeak = peak(melodicIntervals);
  const percussionPeak = peak(percussionIntervals);
  if (!(Number.isInteger(voiceLimit) && voiceLimit >= 1)) failures.push({ code: "invalid-voice-limit", message: "settings voices must be an integer of at least one" });
  else if (allocatorPeak.maximum > voiceLimit) failures.push({ code: "voice-demand-exceeds-budget", message: "uncapped independent melodic allocator demand exceeds settings.voices", required: allocatorPeak.maximum, available: voiceLimit, at: allocatorPeak.at });

  const resultStatus = failures.length ? "fail" : incomplete.length ? "incomplete" : "pass";
  return {
    schemaVersion: 1, status: resultStatus,
    format: parsed.format, trackCount: parsed.trackCount, ppq: parsed.division,
    maxTick: parsed.maxTick, loopSeconds: parsed.loopSeconds,
    mergedOrder: parsed.events.filter((e) => e.kind !== "eot").map((e) => ({ tick: e.tick, seconds: e.seconds, track: e.track, eventIndex: e.index, kind: e.kind, status: e.status, channel: e.channel, data: e.data })),
    notes, openingNotes: opening.map((n) => n && ({ id: n.id, pass: n.pass, tick: n.tick, channel: n.channel, key: n.key, program: n.program, expectedFundamentalHz: n.expectedFundamentalHz, pitchIntent: n.pitchIntent, expectedOperators: n.expectedOperators, state: n.state })),
    changedStateDimensions: [...changedDimensions].sort(), initializers: Object.fromEntries(initializers),
    demand: {
      methodVersion: "periodic-horizon-tail-v1", horizonSeconds, startupAnchorSeconds, schedulerIntervalSeconds,
      maxExpectedTailSeconds: maxExpectedTailSeconds, resourcePasses: analysisPasses, requiredResourcePasses,
      eventCap: MAX_RESOURCE_EVENTS, passCap: MAX_RESOURCE_PASSES, bounded: resourceBoundComplete,
      voices: voiceLimit, allocatorMelodicVoices: allocatorPeak, uncappedOperatorSources: operatorPeak,
      melodicOperatorSources: melodicPeak, percussionOperatorSources: percussionPeak,
      totalOperatorStarts: operatorIntervals.length, secondaryTailMismatches: tailMismatchCount,
      transientDrumHeadroom, allocatorIntervals, operatorIntervals,
    },
    failures, incomplete,
  };

}
