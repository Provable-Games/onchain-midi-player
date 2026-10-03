//! `MockOnchainTinySynth`: a stand-in for the onchain TinySynth class library.
//!
//! It implements the declared `onchain_tinysynth::interface::IOnchainTinySynth` with the exact
//! output layout the real class will use, so a consumer written against it needs no change when
//! the real class hash is swapped in. What is mocked:
//!
//! - `animation_url_segment()` returns a pre-encoded constant, as the real class will, but the page
//!   is a ~5 KB mock (engine placeholder + mock player) instead of TinySynth + the real player. It
//!   is generated offline by `scripts/gen_page.mjs` into `mock_page_data.cairo`.
//! - `midi_segment()` validates only a few `SynthSettings` ranges, rejects `Harmonics`, `Samples`
//!   and filters (issues #2 and #3), and serializes `SETTINGS` in a placeholder format (the real
//!   format is specified with issue #1).
//! - `base64()` is a straightforward byte-wise encoder; the real class plans a word-wise one.
//! - `script_sha256()`, `version()` and `license()` return mock constants.
//!
//! Like the real class, it has no storage and no constructor, and it is declared but never
//! deployed: consumers reach it only through `library_call`.

use core::panic_with_felt252;
use onchain_tinysynth::types::{Operator, SynthSettings, Timbre, Waveform};

/// Closes the settings block and opens the MIDI block.
pub fn midi_open() -> ByteArray {
    "</script><script type=\"text/plain\" id=\"midi\">"
}

/// Closes the MIDI block and opens the art block. The consumer's `b64(S)` supplies its contents.
pub fn art_open() -> ByteArray {
    "</script><script type=\"text/plain\" id=\"art\">"
}

// ------------------------------------------------------------------------------------------------
// base64
// ------------------------------------------------------------------------------------------------

/// One base64 alphabet character for a 6-bit value, without a lookup table.
#[inline(always)]
fn b64_char(v: u32) -> felt252 {
    if v < 26 {
        ('A' + v).into()
    } else if v < 52 {
        ('a' + v - 26).into()
    } else if v < 62 {
        ('0' + v - 52).into()
    } else if v == 62 {
        '+'
    } else {
        '/'
    }
}

/// Standard RFC 4648 base64 with `=` padding and no line breaks. Byte-wise: three input bytes give
/// one 4-character word. Simple rather than fast; good enough for a mock.
pub fn base64(data: @ByteArray) -> ByteArray {
    let mut out: ByteArray = "";
    let len = data.len();
    let mut i: usize = 0;
    while i + 3 <= len {
        let n: u32 = data[i].into() * 0x10000 + data[i + 1].into() * 0x100 + data[i + 2].into();
        let word = b64_char(n / 0x40000) * 0x1000000
            + b64_char((n / 0x1000) % 0x40) * 0x10000
            + b64_char((n / 0x40) % 0x40) * 0x100
            + b64_char(n % 0x40);
        out.append_word(word, 4);
        i += 3;
    }
    let rem = len - i;
    if rem == 1 {
        let n: u32 = data[i].into() * 0x10000;
        let word = b64_char(n / 0x40000) * 0x1000000
            + b64_char((n / 0x1000) % 0x40) * 0x10000
            + '=' * 0x100
            + '=';
        out.append_word(word, 4);
    } else if rem == 2 {
        let n: u32 = data[i].into() * 0x10000 + data[i + 1].into() * 0x100;
        let word = b64_char(n / 0x40000) * 0x1000000
            + b64_char((n / 0x1000) % 0x40) * 0x10000
            + b64_char((n / 0x40) % 0x40) * 0x100
            + '=';
        out.append_word(word, 4);
    }
    out
}

// ------------------------------------------------------------------------------------------------
// SynthSettings: demo validation and the placeholder SETTINGS format
// ------------------------------------------------------------------------------------------------

/// A few range checks, enough to show that invalid settings revert before reaching the page. The
/// real class checks every field (ranges in `types.cairo`, finalized in issues #1-#3).
pub fn validate(settings: @SynthSettings) {
    assert(*settings.quality <= 1, 'mock: quality > 1');
    assert(*settings.reverb <= 100, 'mock: reverb > 100');
    assert(*settings.master_vol <= 100, 'mock: master_vol > 100');
    assert(*settings.voices >= 1 && *settings.voices <= 64, 'mock: voices not in 1..=64');
    assert((*settings.timbres).len() <= 32, 'mock: more than 32 timbres');
    for timbre in *settings.timbres {
        if *timbre.drum {
            assert(*timbre.slot >= 35 && *timbre.slot <= 81, 'mock: drum slot not in 35..=81');
        } else {
            assert(*timbre.slot <= 127, 'mock: program slot > 127');
        }
        let n_ops = (*timbre.operators).len();
        assert(n_ops >= 1 && n_ops <= 8, 'mock: operators not in 1..=8');
        for op in *timbre.operators {
            assert(*op.route <= 18, 'mock: route > 18');
            match op.wave {
                Waveform::Harmonics(_) => panic_with_felt252('mock: Harmonics unsupported'),
                Waveform::Samples(_) => panic_with_felt252('mock: Samples unsupported'),
                _ => {},
            }
            assert(op.filter.is_none(), 'mock: filters unsupported');
        }
    }
}

fn wave_code(wave: @Waveform) -> u32 {
    match wave {
        Waveform::Sine => 0,
        Waveform::Square => 1,
        Waveform::Sawtooth => 2,
        Waveform::Triangle => 3,
        Waveform::WhiteNoise => 4,
        Waveform::MetallicNoise => 5,
        // Rejected by `validate` (issue #2 is not mocked).
        Waveform::Harmonics(_) => panic_with_felt252('mock: Harmonics unsupported'),
        Waveform::Samples(_) => panic_with_felt252('mock: Samples unsupported'),
    }
}

/// Appends `v` in decimal.
fn append_u64(ref out: ByteArray, v: u64) {
    if v == 0 {
        out.append_byte('0');
        return;
    }
    let mut digits: Array<u8> = array![];
    let mut x = v;
    while x != 0 {
        digits.append((x % 10).try_into().unwrap() + '0');
        x /= 10;
    }
    let mut i = digits.len();
    while i != 0 {
        i -= 1;
        out.append_byte(*digits[i]);
    }
}

fn append_i32(ref out: ByteArray, v: i32) {
    let wide: i64 = v.into();
    if wide < 0 {
        out.append_byte('-');
        append_u64(ref out, (-wide).try_into().unwrap());
    } else {
        append_u64(ref out, wide.try_into().unwrap());
    }
}

fn append_operator(ref out: ByteArray, op: @Operator) {
    out.append_byte(':');
    let fields: [u32; 2] = [(*op.route).into(), wave_code(op.wave)];
    for f in fields.span() {
        append_u64(ref out, (*f).into());
        out.append_byte(',');
    }
    append_u64(ref out, (*op.volume).into());
    out.append_byte(',');
    append_u64(ref out, (*op.ratio).into());
    out.append_byte(',');
    append_i32(ref out, *op.offset_hz);
    let rest: [u32; 7] = [
        *op.attack, *op.hold, *op.decay, *op.sustain, *op.release, *op.pitch_ratio, *op.pitch_time,
    ];
    for f in rest.span() {
        out.append_byte(',');
        append_u64(ref out, (*f).into());
    }
    out.append_byte(',');
    append_i32(ref out, *op.key_scale);
}

fn append_timbre(ref out: ByteArray, timbre: @Timbre) {
    out.append_byte(';');
    out.append_byte(if *timbre.drum {
        '1'
    } else {
        '0'
    });
    out.append_byte(',');
    append_u64(ref out, (*timbre.slot).into());
    for op in *timbre.operators {
        append_operator(ref out, op);
    }
}

/// Mock `SETTINGS` format. PLACEHOLDER: the real format belongs to the page version and is
/// specified with issue #1.
///
/// ```text
/// quality,reverb,master_vol,voices{;drum,slot{:op}}
/// op = route,wave,volume,ratio,offset_hz,attack,hold,decay,sustain,release,pitch_ratio,
///      pitch_time,key_scale
/// ```
///
/// Decimal integers (fixed-point fields stay in 1/10_000 units), `-` for negatives, `,` `;` `:`
/// as separators. `drum` is 0 or 1; `wave` is 0..=5 (Sine, Square, Sawtooth, Triangle,
/// WhiteNoise, MetallicNoise). Only digits, `-` and separators, so it can never close its block.
pub fn settings_ascii(settings: @SynthSettings) -> ByteArray {
    let mut out: ByteArray = "";
    append_u64(ref out, (*settings.quality).into());
    out.append_byte(',');
    append_u64(ref out, (*settings.reverb).into());
    out.append_byte(',');
    append_u64(ref out, (*settings.master_vol).into());
    out.append_byte(',');
    append_u64(ref out, (*settings.voices).into());
    for timbre in *settings.timbres {
        append_timbre(ref out, timbre);
    }
    out
}

/// `D = SETTINGS '</script><script type="text/plain" id="midi">' b64(midi) <pad>
/// '</script><script type="text/plain" id="art">'`, with 0..=8 pad spaces so `len(D) % 9 == 0`.
///
/// Why 9 and not 3: `D` is spliced at both layers. At the HTML layer `b64(D)` must not carry `=`
/// (needs `len(D) % 3 == 0`); at the JSON layer `b64(b64(D))` must not either (needs
/// `len(b64(D)) = 4 * len(D) / 3` to be a multiple of 3). Together: `len(D) % 9 == 0`. The spaces
/// sit inside the MIDI text block, where the player strips whitespace before decoding.
pub fn d_fragment(midi: @ByteArray, settings: @SynthSettings) -> ByteArray {
    let close = art_open();
    let mut d = settings_ascii(settings);
    d.append(@midi_open());
    d.append(@base64(midi));
    while (d.len() + close.len()) % 9 != 0 {
        d.append_byte(' ');
    }
    d.append(@close);
    d
}

#[starknet::contract]
pub mod MockOnchainTinySynth {
    use onchain_tinysynth::interface::IOnchainTinySynth;
    use onchain_tinysynth::types::SynthSettings;
    use crate::mock_page_data;

    // No storage and no constructor: the class runs in the caller's context via library_call
    // and must not touch the caller's storage.
    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl MockOnchainTinySynthImpl of IOnchainTinySynth<ContractState> {
        /// The pre-encoded constant from `mock_page_data.cairo`. No base64 work at call time.
        fn animation_url_segment(self: @ContractState) -> ByteArray {
            mock_page_data::animation_url_segment()
        }

        /// Validates `settings`, builds `D`, and returns `b64(b64(D))`.
        fn midi_segment(
            self: @ContractState, midi: ByteArray, settings: SynthSettings,
        ) -> ByteArray {
            super::validate(@settings);
            let d = super::d_fragment(@midi, @settings);
            super::base64(@super::base64(@d))
        }

        fn base64(self: @ContractState, data: ByteArray) -> ByteArray {
            super::base64(@data)
        }

        /// MOCK: SHA-256 of the engine placeholder script embedded in the mock page.
        fn script_sha256(self: @ContractState) -> u256 {
            mock_page_data::ENGINE_SHA256
        }

        fn version(self: @ContractState) -> felt252 {
            'mock-tinysynth.0+mock-page.1'
        }

        fn license(self: @ContractState) -> ByteArray {
            "MOCK. This is not a license notice. The real onchain TinySynth class returns the Apache-2.0 notice for the library and the embedded TinySynth engine (copyright Tatsuya Shinyagaito (g200kg), modified by Provable Games)."
        }
    }
}
