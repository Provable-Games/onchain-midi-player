//! `SETTINGS`: the ASCII encoding of `TinySynthSettings` (format version 1) that `midi_segment`
//! writes into the page, after validating the settings.
//!
//! Specified in issue #1 (spec and shared-wave-table amendment):
//! <https://github.com/Provable-Games/onchain-midi-player/issues/1>. The JavaScript
//! counterparts are `player/settings.js` (the page's strict parser and TinySynth installer; the
//! page does not repeat the checks), `player/validate.js` (reference of the checks, with the same
//! messages; tooling only) and `player/encode.js` (reference encoder); shared fixtures keep them
//! byte-for-byte identical.
//!
//! The checks, their order and their messages are in `tinysynth_interface::settings`
//! (`types/src/settings.cairo`), with `validate`, `default_settings`, `default_operator` and the
//! limits. This module re-exports them, so `onchain_midi_player::settings::validate` keeps its
//! path.
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

pub use tinysynth_interface::settings::*;
use crate::types::{Filter, FilterKind, Operator, TinySynthSettings, WaveDef, Waveform};

/// First token of `SETTINGS`.
pub const SETTINGS_FORMAT_VERSION: u32 = 1;

/// Validates, then encodes. This is what `midi_segment` writes into the page.
pub fn validate_and_encode(settings: @TinySynthSettings) -> ByteArray {
    validate(settings);
    encode(settings)
}

/// Encodes `settings` as `SETTINGS` (the grammar above), covering every variant. Does not
/// range-check fields (call `validate` first).
pub fn encode(settings: @TinySynthSettings) -> ByteArray {
    let mut out: ByteArray = "";
    put_u(ref out, SETTINGS_FORMAT_VERSION);
    comma(ref out);
    put_u(ref out, settings.quality.into());
    comma(ref out);
    put_u(ref out, settings.reverb.into());
    comma(ref out);
    put_u(ref out, settings.master_vol.into());
    comma(ref out);
    put_u(ref out, settings.voices.into());

    let waves = settings.waves;
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

    let timbres = settings.timbres;
    comma(ref out);
    put_u(ref out, timbres.len());
    for timbre in timbres {
        comma(ref out);
        out.append_byte(if timbre.drum {
            '1'
        } else {
            '0'
        });
        comma(ref out);
        put_u(ref out, timbre.slot.into());
        let ops = timbre.operators;
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
    put_u(ref out, op.route.into());
    comma(ref out);
    match op.wave {
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
    put_u(ref out, op.volume);
    comma(ref out);
    put_u(ref out, op.ratio);
    comma(ref out);
    put_i(ref out, op.offset_hz);
    comma(ref out);
    put_u(ref out, op.attack);
    comma(ref out);
    put_u(ref out, op.hold);
    comma(ref out);
    put_u(ref out, op.decay);
    comma(ref out);
    put_u(ref out, op.sustain);
    comma(ref out);
    put_u(ref out, op.release);
    comma(ref out);
    put_u(ref out, op.pitch_ratio);
    comma(ref out);
    put_u(ref out, op.pitch_time);
    comma(ref out);
    put_i(ref out, op.key_scale);
    comma(ref out);
    put_filter(ref out, @op.filter);
}

fn put_filter(ref out: ByteArray, filter: @Option<Filter>) {
    match filter {
        Option::None => out.append_byte('0'),
        Option::Some(f) => {
            out.append_word('1,', 2);
            out
                .append_byte(
                    match f.kind {
                        FilterKind::LowPass => '0',
                        FilterKind::HighPass => '1',
                        FilterKind::BandPass => '2',
                    },
                );
            comma(ref out);
            put_u(ref out, f.cutoff);
            comma(ref out);
            out.append_byte(if f.key_track {
                '1'
            } else {
                '0'
            });
            comma(ref out);
            put_u(ref out, f.q);
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

    fn with_custom(index: u8, waves: Span<WaveDef>) -> super::TinySynthSettings {
        let op = super::Operator { wave: Waveform::Custom(index), ..default_operator() };
        let timbre = Timbre { drum: false, slot: 0, operators: [op].span() };
        super::TinySynthSettings { waves, timbres: [timbre].span(), ..default_settings() }
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
