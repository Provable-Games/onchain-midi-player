//! `SETTINGS`: validation and ASCII encoding of `SynthSettings` (format version 1).
//!
//! Specified in issue #1 (spec and shared-wave-table amendment):
//! <https://github.com/Provable-Games/onchain-tinysynth/issues/1>. The JavaScript
//! counterparts are `player/settings.js` (strict parser, the same checks with the same
//! messages, and the TinySynth installer) and `player/encode.js` (reference encoder); shared
//! fixtures keep both byte-for-byte identical.
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
//! | 2 | `reverb <= 100` | `TS: reverb out of range` |
//! | 3 | `master_vol <= 100` | `TS: master_vol out of range` |
//! | 4 | `1 <= voices <= 64` | `TS: voices out of range` |
//! | 5 | `waves.len() <= 16` | `TS: too many waves` |
//! | 6 | per wave: Harmonics has 1..=64 entries | `TS: harmonics length` |
//! | 6 | per wave: Samples has 2..=256 entries | `TS: samples length` |
//! | 7 | v1, until #2: `waves` is empty | `TS: custom wave unsupported` |
//! | 8 | `timbres.len() <= 32` | `TS: too many timbres` |
//! | 9 | program `slot <= 127` | `TS: program slot out of range` |
//! | 10 | drum `35 <= slot <= 81` | `TS: drum slot out of range` |
//! | 11 | `(drum, slot)` unique | `TS: duplicate timbre slot` |
//! | 12 | at least 1 operator | `TS: no operators` |
//! | 13 | at most 8 operators | `TS: too many operators` |
//! | 14 | `route <= 18` | `TS: route out of range` |
//! | 15 | FM (`1..=10`): target is an earlier operator | `TS: FM target not earlier` |
//! | 16 | AM (`11..`): target `route - 10` is an earlier operator | `TS: AM target not earlier` |
//! | 17 | v1, until #2: `wave` is not `Custom` | `TS: custom wave unsupported` |
//! | 18 | `Custom(i)`: `i < waves.len()` | `TS: wave index out of range` |
//! | 19 | `volume <= 1_000_000` | `TS: volume out of range` |
//! | 20 | `ratio <= 640_000` | `TS: ratio out of range` |
//! | 21 | `-200_000_000 <= offset_hz <= 200_000_000` | `TS: offset_hz out of range` |
//! | 22 | `attack <= 200_000` | `TS: attack out of range` |
//! | 23 | `hold <= 200_000` | `TS: hold out of range` |
//! | 24 | `decay <= 200_000` | `TS: decay out of range` |
//! | 25 | `sustain <= 1_000_000` | `TS: sustain out of range` |
//! | 26 | `release <= 200_000` | `TS: release out of range` |
//! | 27 | `pitch_ratio <= 160_000` | `TS: pitch_ratio out of range` |
//! | 28 | `pitch_time <= 200_000` | `TS: pitch_time out of range` |
//! | 29 | `-80_000 <= key_scale <= 80_000` | `TS: key_scale out of range` |
//! | 30 | until #3: `filter` is `None` | `TS: filter unsupported` |
//! | 31 | (in `encode`) `len(SETTINGS) <= 8192` | `TS: settings too long` |
//!
//! Check 18 cannot be reached while check 17 is in force; issue #2 removes checks 7 and 17
//! without changing the grammar or the format version.

use core::num::traits::Pow;
use crate::types::{Filter, FilterKind, Operator, SynthSettings, Timbre, WaveDef, Waveform};

/// First token of `SETTINGS`.
pub const SETTINGS_FORMAT_VERSION: u32 = 1;
/// Maximum entries in `SynthSettings::waves`.
pub const MAX_WAVES: u32 = 16;
/// Maximum entries in `SynthSettings::timbres`.
pub const MAX_TIMBRES: u32 = 32;
/// Maximum operators per timbre.
pub const MAX_OPERATORS: u32 = 8;
/// Maximum length of the encoded `SETTINGS`, in bytes.
pub const MAX_SETTINGS_LEN: u32 = 8192;
/// Harmonics entries: 1..=MAX_HARMONICS.
pub const MAX_HARMONICS: u32 = 64;
/// Samples entries: MIN_SAMPLES..=MAX_SAMPLES.
pub const MIN_SAMPLES: u32 = 2;
pub const MAX_SAMPLES: u32 = 256;
/// Highest valid `route`: AM on operator `MAX_OPERATORS`.
pub const MAX_ROUTE: u32 = 10 + MAX_OPERATORS;
/// Lowest and highest drum slot reachable from MIDI.
pub const MIN_DRUM_SLOT: u32 = 35;
pub const MAX_DRUM_SLOT: u32 = 81;
/// Highest program slot.
pub const MAX_PROGRAM_SLOT: u32 = 127;
/// Highest `voices`.
pub const MAX_VOICES: u32 = 64;
/// Fixed-point maxima (units of 1 / FIXED_POINT_SCALE).
pub const MAX_VOLUME: u32 = 1_000_000;
pub const MAX_RATIO: u32 = 640_000;
pub const MAX_OFFSET_HZ: i32 = 200_000_000;
/// Shared by `attack`, `hold`, `decay`, `release` and `pitch_time` (20 s).
pub const MAX_TIME: u32 = 200_000;
pub const MAX_SUSTAIN: u32 = 1_000_000;
pub const MAX_PITCH_RATIO: u32 = 160_000;
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

/// Checks every field of `settings` (checks 1–30 above) and reverts on the first failure.
pub fn validate(settings: @SynthSettings) {
    validate_with(settings, false)
}

/// Validates, then encodes. This is what `midi_segment` writes into the page.
pub fn validate_and_encode(settings: @SynthSettings) -> ByteArray {
    validate(settings);
    encode(settings)
}

/// `validate` with the issue #2 gate selectable, so the post-#2 rules are tested now.
pub(crate) fn validate_with(settings: @SynthSettings, custom_waves: bool) {
    assert((*settings.quality).into() <= 1_u32, 'TS: quality out of range');
    assert(*settings.reverb <= 100, 'TS: reverb out of range');
    assert(*settings.master_vol <= 100, 'TS: master_vol out of range');
    let voices: u32 = (*settings.voices).into();
    assert(voices >= 1 && voices <= MAX_VOICES, 'TS: voices out of range');

    let waves = *settings.waves;
    let n_waves = waves.len();
    assert(n_waves <= MAX_WAVES, 'TS: too many waves');
    let mut w: u32 = 0;
    for wave in waves {
        match wave {
            WaveDef::Harmonics(h) => {
                let n = h.len();
                if n < 1 || n > MAX_HARMONICS {
                    fail_at('TS: harmonics length', w);
                }
            },
            WaveDef::Samples(x) => {
                let n = x.len();
                if n < MIN_SAMPLES || n > MAX_SAMPLES {
                    fail_at('TS: samples length', w);
                }
            },
        }
        w += 1;
    }
    assert(custom_waves || n_waves == 0, 'TS: custom wave unsupported');

    let timbres = *settings.timbres;
    assert(timbres.len() <= MAX_TIMBRES, 'TS: too many timbres');
    let mut used_programs: u128 = 0;
    let mut used_drums: u64 = 0;
    let mut t: u32 = 0;
    for timbre in timbres {
        validate_timbre(timbre, t, n_waves, custom_waves, ref used_programs, ref used_drums);
        t += 1;
    }
}

fn validate_timbre(
    timbre: @Timbre,
    t: u32,
    n_waves: u32,
    custom_waves: bool,
    ref used_programs: u128,
    ref used_drums: u64,
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
        validate_operator(op, t, o, n_waves, custom_waves);
        o += 1;
    }
}

fn validate_operator(op: @Operator, t: u32, o: u32, n_waves: u32, custom_waves: bool) {
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
        if !custom_waves {
            fail_at_op('TS: custom wave unsupported', t, o);
        }
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
    if *op.offset_hz < -MAX_OFFSET_HZ || *op.offset_hz > MAX_OFFSET_HZ {
        fail_at_op('TS: offset_hz out of range', t, o);
    }
    if *op.attack > MAX_TIME {
        fail_at_op('TS: attack out of range', t, o);
    }
    if *op.hold > MAX_TIME {
        fail_at_op('TS: hold out of range', t, o);
    }
    if *op.decay > MAX_TIME {
        fail_at_op('TS: decay out of range', t, o);
    }
    if *op.sustain > MAX_SUSTAIN {
        fail_at_op('TS: sustain out of range', t, o);
    }
    if *op.release > MAX_TIME {
        fail_at_op('TS: release out of range', t, o);
    }
    if *op.pitch_ratio > MAX_PITCH_RATIO {
        fail_at_op('TS: pitch_ratio out of range', t, o);
    }
    if *op.pitch_time > MAX_TIME {
        fail_at_op('TS: pitch_time out of range', t, o);
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
/// custom waves and filters, which `validate` rejects in v1. Does not range-check fields
/// (call `validate` first); reverts with `'TS: settings too long'` if the result exceeds
/// `MAX_SETTINGS_LEN` bytes.
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
    assert(out.len() <= MAX_SETTINGS_LEN, 'TS: settings too long');
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
    use super::{default_operator, default_settings, encode, put_i, put_u, validate_with};

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

    // Check 18 is unreachable through `validate` until issue #2 removes checks 7 and 17.
    #[test]
    fn custom_wave_index_in_range_after_issue_2() {
        let waves = [WaveDef::Harmonics([1, 1].span()), WaveDef::Samples([1, -1].span())].span();
        validate_with(@with_custom(1, waves), true);
    }

    #[test]
    #[should_panic(expected: ('TS: wave index out of range', 0, 0))]
    fn custom_wave_index_out_of_range_after_issue_2() {
        let waves = [WaveDef::Harmonics([1].span()), WaveDef::Samples([1, -1].span())].span();
        validate_with(@with_custom(2, waves), true);
    }

    #[test]
    #[should_panic(expected: ('TS: wave index out of range', 0, 0))]
    fn custom_wave_without_table_after_issue_2() {
        validate_with(@with_custom(0, [].span()), true);
    }
}
