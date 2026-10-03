//! `MockOnchainTinySynth`: a stand-in for the onchain TinySynth class library.
//!
//! It implements the declared `onchain_tinysynth::interface::IOnchainTinySynth` with the exact
//! output layout the real class will use, so a consumer written against it needs no change when
//! the real class hash is swapped in. What is mocked:
//!
//! - `animation_url_segment()` returns a pre-encoded constant, as the real class will, but the page
//!   is a mock (engine placeholder + mock player around the real settings parser) instead of
//!   TinySynth + the real player. It
//!   is generated offline by `scripts/gen_page.mjs` into `mock_page_data.cairo`.
//! - `midi_segment()` is real apart from `base64()`: it uses the crate's `settings::validate` and
//!   `settings::encode` (issue #1), so `SETTINGS` is the real format and invalid settings revert
//!   with the real `'TS: ...'` messages.
//! - `base64()` is a straightforward byte-wise encoder; the real class plans a word-wise one.
//! - `script_sha256()`, `version()` and `license()` return mock constants.
//!
//! Like the real class, it has no storage and no constructor, and it is declared but never
//! deployed: consumers reach it only through `library_call`.

use onchain_tinysynth::settings;
use onchain_tinysynth::types::SynthSettings;

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
// SynthSettings: the real validation and SETTINGS encoding
// ------------------------------------------------------------------------------------------------

/// The real `SETTINGS` (issue #1, format version 1), from the crate's `settings::encode`.
/// `midi_segment` runs `settings::validate` first, which checks every field and reverts with the
/// real `'TS: ...'` messages.
pub fn settings_ascii(settings: @SynthSettings) -> ByteArray {
    settings::encode(settings)
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
            onchain_tinysynth::settings::validate(@settings);
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
