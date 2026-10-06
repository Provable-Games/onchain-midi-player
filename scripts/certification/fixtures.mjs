// @ts-nocheck
// Deterministic hand-authored SMF fixtures for the independent oracle. These bytes are intentionally
// small enough to review; this builder does not import the page's MIDI parser or TinySynth.

const be = (value, count) => Array.from({ length: count }, (_, i) => (value >>> (8 * (count - 1 - i))) & 255);
const vlq = (value) => {
  const bytes = [value & 127];
  while ((value >>>= 7)) bytes.unshift((value & 127) | 128);
  return bytes;
};

/** @param {number[][]} events @param {number} ppq @param {number} format */
export function smf(events, ppq = 480, format = 0) {
  const body = events.flatMap((event) => [...vlq(event[0]), ...event.slice(1)]);
  const track = [...Buffer.from("MTrk"), ...be(body.length, 4), ...body];
  return Buffer.from([...Buffer.from("MThd"), ...be(6, 4), ...be(format, 2), ...be(1, 2), ...be(ppq, 2), ...track]);
}

const tempo = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20];
const eot = (delta = 0) => [delta, 0xff, 0x2f, 0];
const sysex = (delta, data) => [delta, 0xf0, ...vlq(data.length), ...data];

export const SIMPLE_SETTINGS = {
  quality: 1,
  reverb: 0,
  master_vol: 100,
  voices: 8,
  waves: [],
  timbres: [{
    drum: false,
    slot: 0,
    operators: [{
      route: 0, wave: "Sine", volume: 10000, ratio: 10000, offset_hz: 0,
      attack: 30, hold: 0, decay: 0, sustain: 10000, release: 100,
      pitch_ratio: 10000, pitch_time: 10000, key_scale: 0, filter: null,
    }],
  }],
};

export const GOOD_MIDI = smf([
  tempo,
  [0, 0xc0, 0],
  [0, 0xb0, 7, 100],
  [0, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  [48, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  [96, 0x90, 72, 100],
  [48, 0x80, 72, 0],
  eot(192),
]);

export const INITIALIZED_TUNING_MIDI = smf([
  tempo,
  sysex(0, [0x7f, 0x7f, 0x04, 0x04, 0x00, 0x40, 0xf7]),
  [0, 0xc0, 0],
  [0, 0xb0, 7, 100],
  [0, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  sysex(48, [0x7f, 0x7f, 0x04, 0x04, 0x00, 0x4c, 0xf7]),
  [240, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  eot(96),
]);

export const OFF_BEFORE_ON_MIDI = smf([
  tempo,
  [0, 0xc0, 0],
  [0, 0xb0, 7, 100],
  [0, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  [0, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  eot(384),
]);

export const ON_BEFORE_OFF_MIDI = smf([
  tempo,
  [0, 0xc0, 0],
  [0, 0xb0, 7, 100],
  [0, 0x90, 60, 100],
  [48, 0x90, 60, 100],
  [0, 0x80, 60, 0],
  [48, 0x80, 60, 0],
  eot(384),
]);

export const ZERO_LENGTH_MIDI = smf([
  tempo,
  [0, 0xc0, 0],
  [0, 0xb0, 7, 100],
  [0, 0x90, 60, 100],
  [0, 0x80, 60, 0],
  eot(480),
]);

export const CC121_MIDI = smf([
  tempo,
  [0, 0xc0, 0],
  [0, 0xb0, 7, 100],
  [0, 0xb0, 121, 0],
  [0, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  eot(432),
]);

export const PEAK_DEMAND_MIDI = smf([
  tempo,
  [0, 0xc0, 0],
  [0, 0xb0, 7, 100],
  [0, 0x90, 60, 100],
  [0, 0x90, 64, 100],
  [240, 0x80, 60, 0],
  [0, 0x80, 64, 0],
  eot(240),
]);

export const CC121_SETTINGS = SIMPLE_SETTINGS;
export const ONE_VOICE_SETTINGS = { ...SIMPLE_SETTINGS, voices: 1 };
export const EXTREME_SETTINGS = {
  ...SIMPLE_SETTINGS,
  timbres: [{ ...SIMPLE_SETTINGS.timbres[0], operators: [{ ...SIMPLE_SETTINGS.timbres[0].operators[0], key_scale: 1000000 }] }],
};
export const EXTREME_KEY_MIDI = smf([
  tempo,
  [0, 0xc0, 0],
  [0, 0xb0, 7, 100],
  [0, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  [48, 0x90, 127, 100],
  [48, 0x80, 127, 0],
  eot(288),
]);

const EOT = [0xff, 0x2f, 0];
/** Format 1 tie: existing note is in track 1; new note precedes its off in track 0 at tick 48. */
export const FORMAT1_ON_BEFORE_OFF_MIDI = (() => {
  const track = (ev) => ev.flatMap((e) => [...vlq(e[0]), ...e.slice(1)]);
  const t0 = track([[0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20], [0, 0xc0, 0], [0, 0xb0, 7, 100], [48, 0x90, 60, 100], [0, ...EOT]]);
  const t1 = track([[0, 0x90, 60, 100], [48, 0x80, 60, 0], [432, ...EOT]]);
  const chunk = (body) => [...Buffer.from("MTrk"), ...be(body.length, 4), ...body];
  return Buffer.from([...Buffer.from("MThd"), ...be(6, 4), ...be(1, 2), ...be(2, 2), ...be(480, 2), ...chunk(t0), ...chunk(t1)]);
})();

/** Master coarse tuning first appears after the opening note: exact onsets/count hide an octave drift. */
export const LATE_MASTER_COARSE_TUNING_MIDI = smf([
  tempo,
  [0, 0xc0, 0],
  [0, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  sysex(192, [0x7f, 0x7f, 0x04, 0x04, 0x00, 0x4c, 0xf7]),
  [0, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  eot(192),
]);

/** Same intended +12 semitone master tuning is initialized before tick-zero notes on every pass. */
export const INITIALIZED_MASTER_COARSE_TUNING_MIDI = smf([
  tempo,
  sysex(0, [0x7f, 0x7f, 0x04, 0x04, 0x00, 0x4c, 0xf7]),
  [0, 0xc0, 0],
  [0, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  eot(432),
]);

/** RPN 0 selects two semitones and zero cents; bend value 0 is the exact negative endpoint. */
export const BEND_RANGE_MIDI = smf([
  tempo,
  [0, 0xb0, 101, 0],
  [0, 0xb0, 100, 0],
  [0, 0xb0, 6, 2],
  [0, 0xb0, 38, 0],
  [0, 0xe0, 0, 0],
  [0, 0xc0, 0],
  [0, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  eot(432),
]);

export const SAMPLE_BEND_SETTINGS = {
  ...SIMPLE_SETTINGS,
  waves: [{ Samples: [0, 127, 0, -127] }],
  timbres: [{ ...SIMPLE_SETTINGS.timbres[0], operators: [
    { ...SIMPLE_SETTINGS.timbres[0].operators[0], wave: { Custom: 0 } },
  ] }],
};

/** A nonzero bend arrives while a custom BufferSource note is still held. */
export const HELD_SAMPLE_BEND_MIDI = smf([
  tempo,
  [0, 0xc0, 0],
  [0, 0x90, 60, 100],
  [24, 0xe0, 0, 100],
  [72, 0x80, 60, 0],
  eot(384),
]);

/** 50 ms loop: a three-pass-only demand check sees three notes, but release tails accumulate over time. */
export const SHORT_LOOP_LONG_TAIL_MIDI = smf([
  tempo,
  [0, 0xc0, 0],
  [0, 0x90, 60, 100],
  [12, 0x80, 60, 0],
  eot(36),
]);

/** Existing same-key note-off precedes the retrigger at tick 48 across format-1 tracks. */
export const FORMAT1_OFF_BEFORE_ON_MIDI = (() => {
  const track = (events) => events.flatMap((event) => [...vlq(event[0]), ...event.slice(1)]);
  const t0 = track([[0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20], [0, 0xc0, 0], [0, 0x90, 60, 100], [48, 0x80, 60, 0], [432, ...EOT]]);
  const t1 = track([[48, 0x90, 60, 100], [48, 0x80, 60, 0], [384, ...EOT]]);
  const chunk = (body) => [...Buffer.from("MTrk"), ...be(body.length, 4), ...body];
  return Buffer.from([...Buffer.from("MThd"), ...be(6, 4), ...be(1, 2), ...be(2, 2), ...be(480, 2), ...chunk(t0), ...chunk(t1)]);
})();

export const SECONDARY_TAIL_SETTINGS = {
  ...SIMPLE_SETTINGS,
  voices: 128,
  timbres: [{ ...SIMPLE_SETTINGS.timbres[0], operators: [
    { ...SIMPLE_SETTINGS.timbres[0].operators[0], release: 100 },
    { ...SIMPLE_SETTINGS.timbres[0].operators[0], route: 1, wave: "Sine", ratio: 0, offset_hz: 6, volume: 1000, release: 20000 },
  ] }],
};

export const LONG_TAIL_SETTINGS = {
  ...SIMPLE_SETTINGS,
  voices: 16,
  timbres: [{ ...SIMPLE_SETTINGS.timbres[0], operators: [
    { ...SIMPLE_SETTINGS.timbres[0].operators[0], release: 20000 },
  ] }],
};

/** Pedal holds the released note until tick 480 (500 ms), then the ordinary release tail begins. */
export const LONG_SUSTAIN_MIDI = smf([
  tempo,
  [0, 0xc0, 0],
  [0, 0xb0, 64, 127],
  [0, 0x90, 60, 100],
  [48, 0x80, 60, 0],
  [432, 0xb0, 64, 0],
  eot(480),
]);
