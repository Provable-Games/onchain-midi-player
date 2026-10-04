//! `SETTINGS`: validation and ASCII encoding of `SynthSettings` (format version 1).
//!
//! Specified in issue #1 (spec and shared-wave-table amendment):
//! <https://github.com/Provable-Games/onchain-tinysynth/issues/1>. The JavaScript
//! counterparts are `player/settings.js` (the page's strict parser and TinySynth installer; the
//! page does not repeat these checks), `player/validate.js` (reference of these checks, with the
//! same messages; tooling only) and `player/encode.js` (reference encoder); shared fixtures keep
//! them byte-for-byte identical.
//!
//! # Grammar
//!
//! A flat list of canonical decimal integers separated by `,`, mirroring Cairo Serde:
//! fields in declaration order, a length prefix before every span, enums as their variant
//! index followed by any payload, `bool` as 0/1. Two differences from Serde: signed values
//! carry a `-` sign, and `Option` is `0` for `None` or `1` followed by the payload.
//! Fixed-point fields are written as their stored integer.
//!
//! ```text
//! settings = version "," quality "," reverb "," master_vol "," voices
//!            "," n_waves { "," wavedef } "," n_timbres { "," timbre } ;
//! version  = "1" ;
//! wavedef  = "0" "," n_harm { "," uint }          (* WaveDef::Harmonics *)
//!          | "1" "," n_samp { "," int } ;         (* WaveDef::Samples *)
//! timbre   = drum "," slot "," n_ops { "," operator } ;
//! operator = route "," wave "," volume "," ratio "," offset_hz "," attack "," hold ","
//!            decay "," sustain "," release "," pitch_ratio "," pitch_time "," key_scale
//!            "," filter ;
//! wave     = "0" | "1" | "2" | "3" | "4" | "5"    (* Sine .. MetallicNoise *)
//!          | "6" "," wave_index ;                 (* Custom *)
//! filter   = "0" | "1" "," kind "," cutoff "," key_track "," q ;
//! uint     = "0" | nonzero { digit } ;
//! int      = "0" | [ "-" ] nonzero { digit } ;
//! ```
//!
//! Every token matches `^(0|-?[1-9][0-9]*)$`, so each value has exactly one encoding. The
//! output contains only `0-9`, `-` and `,`: it can never contain `<`, so it can never close
//! its `<script type="text/plain">` block. It needs no alignment: the padding of `D` sits
//! after `b64(midi)`. Example, `default_settings()`: `1,1,30,40,64,0,0`.
//!
//! # Checks
//!
//! `validate` applies these checks in this order and reverts on the first failure. Panic
//! data is the short string, followed by 0-based indices where they help locate the entry:
//! `(msg)` for settings-level checks, `(msg, wave)` for wave checks, `(msg, timbre)` for
//! timbre checks and `(msg, timbre, operator)` for operator checks.
//!
//! | # | Check | Message |
//! | -- | -- | -- |
//! | 1 | `quality <= 1` | `TS: quality out of range` |
//! | 2 | `voices >= 1` | `TS: voices out of range` |
//! | 3 | `waves.len() <= 256` | `TS: too many waves` |
//! | 4 | per wave: Harmonics has at least 1 entry | `TS: harmonics length` |
//! | 4 | per wave: Samples has at least 1 entry | `TS: samples length` |
//! | 5 | `timbres.len() <= 175` | `TS: too many timbres` |
//! | 6 | program `slot <= 127` | `TS: program slot out of range` |
//! | 7 | drum `35 <= slot <= 81` | `TS: drum slot out of range` |
//! | 8 | `(drum, slot)` unique | `TS: duplicate timbre slot` |
//! | 9 | at least 1 operator | `TS: no operators` |
//! | 10 | at most 8 operators | `TS: too many operators` |
//! | 11 | `route <= 18` | `TS: route out of range` |
//! | 12 | FM (`1..=10`): target is an earlier operator | `TS: FM target not earlier` |
//! | 13 | AM (`11..`): target `route - 10` is an earlier operator | `TS: AM target not earlier` |
//! | 14 | `Custom(i)`: `i < waves.len()` | `TS: wave index out of range` |
//! | 15 | interim, engine limit: `volume <= 1_000_000` | `TS: volume out of range` |
//! | 16 | interim, engine limit: `ratio <= 640_000` | `TS: ratio out of range` |
//! | 17 | interim, engine limit: `pitch_ratio <= 160_000` | `TS: pitch_ratio out of range` |
//! | 18 | interim, engine limit: `sustain <= 1_000_000` | `TS: sustain out of range` |
//! | 19 | interim, engine limit: `-80_000 <= key_scale <= 80_000` | `TS: key_scale out of range` |
//! | 20 | until #3: `filter` is `None` | `TS: filter unsupported` |
//!
//! Only what the format or the engine requires is checked, never a limit for gas or size: the
//! network prices those. The other numeric fields (`reverb`, `master_vol`, the upper end of
//! `voices`, and the other operator values) take any value of their integer type: the engine takes
//! them (`setMasterVol`, `setReverbLev` and `setVoices` assign them, and Web Audio clamps
//! frequencies).
//!
//! Checks 15-19 exist only because the pinned engine fails beyond them. These five fields multiply
//! into the gains and frequencies the engine passes to Web Audio, which requires finite values:
//! past the bounds an overflowing product throws, and the throwing note stalls the whole scheduler.
//! They are interim, to be removed once the pinned engine guards non-finite computed values (fork
//! issue #13, task T5.2; T5 checks the values `setTimbre` receives, not what they multiply into).
//! README, "Engine limits on operator values".
//!
//! Custom waves (issue #2) need no check beyond the counts, lengths and index above: the player
//! registers each wave with the engine's `setSampleWave` or `setHarmonicWave` (fork #26), which
//! take any table of at least one sample or harmonic, every `i8` sample and every `u16` harmonic.
//! An all-zero wave is silent. Issue #2 removed v1's two `'TS: custom wave unsupported'` checks
//! without changing the grammar or the format version.

use core::num::traits::Pow;
use crate::types::{Filter, FilterKind, Operator, SynthSettings, Timbre, WaveDef, Waveform};

/// First token of `SETTINGS`.
pub const SETTINGS_FORMAT_VERSION: u32 = 1;

// The counts are what the format and the engine require, and nothing tighter: every slot once,
// every wave `Waveform::Custom(u8)` can index, and per wave what the engine's custom-wave API takes
// (webaudio-tinysynth #26, decision D-028 of the fork's docs/improvements/decisions.md): at least
// one harmonic or one sample, with no upper bound. There is no byte cap on `SETTINGS` either: the
// network prices its size in gas (README, "Gas and limits").

/// Maximum entries in `SynthSettings::waves`: all that `Waveform::Custom(u8)` can index.
pub const MAX_WAVES: u32 = 256;
/// Maximum entries in `SynthSettings::timbres`: every slot reachable from MIDI, 128 programs
/// (0..=127) plus 47 drum notes (35..=81). Each `(drum, slot)` pair may appear once (check 8), so
/// no valid input has more; checking the count first bounds the loop before any per-timbre work.
pub const MAX_TIMBRES: u32 = 175;
/// Maximum operators per timbre.
pub const MAX_OPERATORS: u32 = 8;
/// Fewest `Harmonics` entries, element `i` being harmonic `i + 1`: the engine takes `real` and
/// `imag` of at least 2 entries, the first for DC. No upper bound.
pub const MIN_HARMONICS: u32 = 1;
/// Fewest `Samples` entries: the engine takes any non-empty table. No upper bound.
pub const MIN_SAMPLES: u32 = 1;
/// Highest valid `route`: AM on operator `MAX_OPERATORS`.
pub const MAX_ROUTE: u32 = 10 + MAX_OPERATORS;
/// Lowest and highest drum slot reachable from MIDI.
pub const MIN_DRUM_SLOT: u32 = 35;
pub const MAX_DRUM_SLOT: u32 = 81;
/// Highest program slot.
pub const MAX_PROGRAM_SLOT: u32 = 127;
/// Fewest `voices`: with none, every note would be cut.
pub const MIN_VOICES: u32 = 1;
/// Interim engine limits (checks 15-19), in fixed point: the largest values of the fields that
/// multiply into the engine's gains and frequencies that the pinned engine plays without computing
/// a non-finite value. To be removed once it guards them (fork #13, task T5.2).
pub const MAX_VOLUME: u32 = 1_000_000;
pub const MAX_RATIO: u32 = 640_000;
pub const MAX_PITCH_RATIO: u32 = 160_000;
pub const MAX_SUSTAIN: u32 = 1_000_000;
pub const MAX_KEY_SCALE: i32 = 80_000;

/// Default engine settings: quality 1, reverb 30 %, master volume 40 %, 64 voices, no custom
/// waves or timbres. Encodes as `1,1,30,40,64,0,0`.
pub fn default_settings() -> SynthSettings {
    SynthSettings {
        quality: 1, reverb: 30, master_vol: 40, voices: 64, waves: [].span(), timbres: [].span(),
    }
}

/// TinySynth's operator defaults
/// (`{g:0,w:"sine",t:1,f:0,v:0.5,a:0,h:0.01,d:0.01,s:0,r:0.05,p:1,q:1,k:0}`) in fixed-point.
pub fn default_operator() -> Operator {
    Operator {
        route: 0,
        wave: Waveform::Sine,
        volume: 5_000,
        ratio: 10_000,
        offset_hz: 0,
        attack: 0,
        hold: 100,
        decay: 100,
        sustain: 0,
        release: 500,
        pitch_ratio: 10_000,
        pitch_time: 10_000,
        key_scale: 0,
        filter: Option::None,
    }
}

/// Applies the checks above to `settings`, in order, and reverts on the first failure.
pub fn validate(settings: @SynthSettings) {
    assert((*settings.quality).into() <= 1_u32, 'TS: quality out of range');
    assert((*settings.voices).into() >= MIN_VOICES, 'TS: voices out of range');

    let waves = *settings.waves;
    let n_waves = waves.len();
    assert(n_waves <= MAX_WAVES, 'TS: too many waves');
    let mut w: u32 = 0;
    for wave in waves {
        match wave {
            WaveDef::Harmonics(h) => {
                let n = h.len();
                if n < MIN_HARMONICS {
                    fail_at('TS: harmonics length', w);
                }
            },
            WaveDef::Samples(x) => {
                let n = x.len();
                if n < MIN_SAMPLES {
                    fail_at('TS: samples length', w);
                }
            },
        }
        w += 1;
    }

    let timbres = *settings.timbres;
    assert(timbres.len() <= MAX_TIMBRES, 'TS: too many timbres');
    let mut used_programs: u128 = 0;
    let mut used_drums: u64 = 0;
    let mut t: u32 = 0;
    for timbre in timbres {
        validate_timbre(timbre, t, n_waves, ref used_programs, ref used_drums);
        t += 1;
    }
}

/// Validates, then encodes. This is what `midi_segment` writes into the page.
pub fn validate_and_encode(settings: @SynthSettings) -> ByteArray {
    validate(settings);
    encode(settings)
}

fn validate_timbre(
    timbre: @Timbre, t: u32, n_waves: u32, ref used_programs: u128, ref used_drums: u64,
) {
    let slot: u32 = (*timbre.slot).into();
    if *timbre.drum {
        if slot < MIN_DRUM_SLOT || slot > MAX_DRUM_SLOT {
            fail_at('TS: drum slot out of range', t);
        }
        let bit: u64 = 2_u64.pow(slot - MIN_DRUM_SLOT);
        if used_drums & bit != 0 {
            fail_at('TS: duplicate timbre slot', t);
        }
        used_drums = used_drums | bit;
    } else {
        if slot > MAX_PROGRAM_SLOT {
            fail_at('TS: program slot out of range', t);
        }
        let bit: u128 = 2_u128.pow(slot);
        if used_programs & bit != 0 {
            fail_at('TS: duplicate timbre slot', t);
        }
        used_programs = used_programs | bit;
    }
    let ops = *timbre.operators;
    if ops.len() < 1 {
        fail_at('TS: no operators', t);
    }
    if ops.len() > MAX_OPERATORS {
        fail_at('TS: too many operators', t);
    }
    let mut o: u32 = 0;
    for op in ops {
        validate_operator(op, t, o, n_waves);
        o += 1;
    }
}

fn validate_operator(op: @Operator, t: u32, o: u32, n_waves: u32) {
    // 1-based position of this operator, as TinySynth's `g` counts.
    let pos = o + 1;
    let route: u32 = (*op.route).into();
    if route > MAX_ROUTE {
        fail_at_op('TS: route out of range', t, o);
    }
    if route >= 1 && route <= 10 && route >= pos {
        fail_at_op('TS: FM target not earlier', t, o);
    }
    if route >= 11 && route - 10 >= pos {
        fail_at_op('TS: AM target not earlier', t, o);
    }
    if let Waveform::Custom(i) = *op.wave {
        if i.into() >= n_waves {
            fail_at_op('TS: wave index out of range', t, o);
        }
    }
    if *op.volume > MAX_VOLUME {
        fail_at_op('TS: volume out of range', t, o);
    }
    if *op.ratio > MAX_RATIO {
        fail_at_op('TS: ratio out of range', t, o);
    }
    if *op.pitch_ratio > MAX_PITCH_RATIO {
        fail_at_op('TS: pitch_ratio out of range', t, o);
    }
    if *op.sustain > MAX_SUSTAIN {
        fail_at_op('TS: sustain out of range', t, o);
    }
    if *op.key_scale < -MAX_KEY_SCALE || *op.key_scale > MAX_KEY_SCALE {
        fail_at_op('TS: key_scale out of range', t, o);
    }
    if op.filter.is_some() {
        fail_at_op('TS: filter unsupported', t, o);
    }
}

fn fail_at(msg: felt252, index: u32) -> core::never {
    panic(array![msg, index.into()])
}

fn fail_at_op(msg: felt252, t: u32, o: u32) -> core::never {
    panic(array![msg, t.into(), o.into()])
}

/// Encodes `settings` as `SETTINGS` (the grammar above), covering every variant, including
/// filters, which `validate` rejects until issue #3. Does not range-check fields (call `validate`
/// first).
pub fn encode(settings: @SynthSettings) -> ByteArray {
    let mut out: ByteArray = "";
    put_u(ref out, SETTINGS_FORMAT_VERSION);
    comma(ref out);
    put_u(ref out, (*settings.quality).into());
    comma(ref out);
    put_u(ref out, (*settings.reverb).into());
    comma(ref out);
    put_u(ref out, (*settings.master_vol).into());
    comma(ref out);
    put_u(ref out, (*settings.voices).into());

    let waves = *settings.waves;
    comma(ref out);
    put_u(ref out, waves.len());
    for wave in waves {
        comma(ref out);
        match wave {
            WaveDef::Harmonics(h) => {
                out.append_word('0,', 2);
                put_u(ref out, h.len());
                for x in *h {
                    comma(ref out);
                    put_u(ref out, (*x).into());
                }
            },
            WaveDef::Samples(s) => {
                out.append_word('1,', 2);
                put_u(ref out, s.len());
                for x in *s {
                    comma(ref out);
                    put_i(ref out, (*x).into());
                }
            },
        }
    }

    let timbres = *settings.timbres;
    comma(ref out);
    put_u(ref out, timbres.len());
    for timbre in timbres {
        comma(ref out);
        out.append_byte(if *timbre.drum {
            '1'
        } else {
            '0'
        });
        comma(ref out);
        put_u(ref out, (*timbre.slot).into());
        let ops = *timbre.operators;
        comma(ref out);
        put_u(ref out, ops.len());
        for op in ops {
            comma(ref out);
            put_operator(ref out, op);
        }
    }
    out
}

fn put_operator(ref out: ByteArray, op: @Operator) {
    put_u(ref out, (*op.route).into());
    comma(ref out);
    match *op.wave {
        Waveform::Sine => out.append_byte('0'),
        Waveform::Square => out.append_byte('1'),
        Waveform::Sawtooth => out.append_byte('2'),
        Waveform::Triangle => out.append_byte('3'),
        Waveform::WhiteNoise => out.append_byte('4'),
        Waveform::MetallicNoise => out.append_byte('5'),
        Waveform::Custom(i) => {
            out.append_word('6,', 2);
            put_u(ref out, i.into());
        },
    }
    comma(ref out);
    put_u(ref out, *op.volume);
    comma(ref out);
    put_u(ref out, *op.ratio);
    comma(ref out);
    put_i(ref out, *op.offset_hz);
    comma(ref out);
    put_u(ref out, *op.attack);
    comma(ref out);
    put_u(ref out, *op.hold);
    comma(ref out);
    put_u(ref out, *op.decay);
    comma(ref out);
    put_u(ref out, *op.sustain);
    comma(ref out);
    put_u(ref out, *op.release);
    comma(ref out);
    put_u(ref out, *op.pitch_ratio);
    comma(ref out);
    put_u(ref out, *op.pitch_time);
    comma(ref out);
    put_i(ref out, *op.key_scale);
    comma(ref out);
    put_filter(ref out, op.filter);
}

fn put_filter(ref out: ByteArray, filter: @Option<Filter>) {
    match filter {
        Option::None => out.append_byte('0'),
        Option::Some(f) => {
            out.append_word('1,', 2);
            out
                .append_byte(
                    match *f.kind {
                        FilterKind::LowPass => '0',
                        FilterKind::HighPass => '1',
                        FilterKind::BandPass => '2',
                    },
                );
            comma(ref out);
            put_u(ref out, *f.cutoff);
            comma(ref out);
            out.append_byte(if *f.key_track {
                '1'
            } else {
                '0'
            });
            comma(ref out);
            put_u(ref out, *f.q);
        },
    }
}

#[inline(always)]
fn comma(ref out: ByteArray) {
    out.append_byte(',');
}

#[inline(always)]
fn digit(v: u32) -> felt252 {
    (v + '0').into()
}

/// Four decimal digits of `v < 10_000`, zero-padded, as one word.
#[inline(always)]
fn four_digits(v: u32) -> felt252 {
    digit(v / 1000) * 0x1000000
        + digit((v / 100) % 10) * 0x10000
        + digit((v / 10) % 10) * 0x100
        + digit(v % 10)
}

/// Appends `v` in canonical decimal (no leading zeros), up to four digits per word.
pub(crate) fn put_u(ref out: ByteArray, v: u32) {
    if v < 10 {
        out.append_word(digit(v), 1);
    } else if v < 100 {
        out.append_word(digit(v / 10) * 0x100 + digit(v % 10), 2);
    } else if v < 1000 {
        out.append_word(digit(v / 100) * 0x10000 + digit((v / 10) % 10) * 0x100 + digit(v % 10), 3);
    } else if v < 10000 {
        out.append_word(four_digits(v), 4);
    } else {
        put_u(ref out, v / 10000);
        out.append_word(four_digits(v % 10000), 4);
    }
}

/// Appends `v` in canonical decimal, with `-` for negative values (never `-0`).
pub(crate) fn put_i(ref out: ByteArray, v: i32) {
    if v < 0 {
        out.append_byte('-');
        let wide: i64 = v.into();
        put_u(ref out, (-wide).try_into().unwrap());
    } else {
        put_u(ref out, v.try_into().unwrap());
    }
}

#[cfg(test)]
mod tests {
    use crate::types::{Timbre, WaveDef, Waveform};
    use super::{default_operator, default_settings, encode, put_i, put_u, validate};

    fn dec_u(v: u32) -> ByteArray {
        let mut out = "";
        put_u(ref out, v);
        out
    }

    fn dec_i(v: i32) -> ByteArray {
        let mut out = "";
        put_i(ref out, v);
        out
    }

    #[test]
    fn canonical_unsigned() {
        assert_eq!(dec_u(0), "0");
        assert_eq!(dec_u(9), "9");
        assert_eq!(dec_u(10), "10");
        assert_eq!(dec_u(99), "99");
        assert_eq!(dec_u(100), "100");
        assert_eq!(dec_u(999), "999");
        assert_eq!(dec_u(1000), "1000");
        assert_eq!(dec_u(9999), "9999");
        assert_eq!(dec_u(10000), "10000");
        assert_eq!(dec_u(10001), "10001");
        assert_eq!(dec_u(100000000), "100000000");
        assert_eq!(dec_u(4294967295), "4294967295");
    }

    #[test]
    fn canonical_signed() {
        assert_eq!(dec_i(0), "0");
        assert_eq!(dec_i(-1), "-1");
        assert_eq!(dec_i(-10000), "-10000");
        assert_eq!(dec_i(2147483647), "2147483647");
        assert_eq!(dec_i(-2147483648), "-2147483648");
    }

    #[test]
    fn default_settings_encoding() {
        assert_eq!(encode(@default_settings()), "1,1,30,40,64,0,0");
    }

    fn with_custom(index: u8, waves: Span<WaveDef>) -> super::SynthSettings {
        let op = super::Operator { wave: Waveform::Custom(index), ..default_operator() };
        let timbre = Timbre { drum: false, slot: 0, operators: [op].span() };
        super::SynthSettings { waves, timbres: [timbre].span(), ..default_settings() }
    }

    #[test]
    fn custom_wave_index_in_range() {
        let waves = [WaveDef::Harmonics([1, 1].span()), WaveDef::Samples([1, -1].span())].span();
        validate(@with_custom(1, waves));
    }

    #[test]
    #[should_panic(expected: ('TS: wave index out of range', 0, 0))]
    fn custom_wave_index_out_of_range() {
        let waves = [WaveDef::Harmonics([1].span()), WaveDef::Samples([1, -1].span())].span();
        validate(@with_custom(2, waves));
    }

    #[test]
    #[should_panic(expected: ('TS: wave index out of range', 0, 0))]
    fn custom_wave_without_table() {
        validate(@with_custom(0, [].span()));
    }
}
