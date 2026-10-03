//! The per-token piece of the page: `D` and `midi_segment` (see `crate::interface`).
//!
//! ```text
//! D = SETTINGS '</script><script type="text/plain" id="midi">' b64(midi) <pad>
//!     '</script><script type="text/plain" id="art">'
//! midi_segment(midi, settings) = b64(b64(D))
//! ```
//!
//! `SETTINGS` comes from `settings::validate_and_encode`, so invalid settings revert before
//! anything is encoded. `<pad>` is 0..=8 spaces, chosen so that `len(D) % 9 == 0`: then `b64(D)` is
//! unpadded and a multiple of 3 long, and `b64(b64(D))` is unpadded, so the result splices into
//! the consumer's base64 stream at both layers. The spaces sit inside the MIDI text block, where
//! the player trims them. `b64(midi)` may end with `=`: inside `D` it is plain text.
//!
//! All base64 goes through `base64::bytes_base64_encode`, the crate's one encoder.

use core::panic_with_felt252;
use crate::base64::bytes_base64_encode;
use crate::settings::validate_and_encode;
use crate::types::SynthSettings;

/// Length of `midi_open()`.
pub const MIDI_OPEN_LEN: u32 = 45;
/// Length of `art_open()`.
pub const ART_OPEN_LEN: u32 = 44;

/// Closes the settings block and opens the MIDI block (`MIDI_OPEN_LEN` bytes).
pub fn midi_open() -> ByteArray {
    "</script><script type=\"text/plain\" id=\"midi\">"
}

/// Closes the MIDI block and opens the art block (`ART_OPEN_LEN` bytes). The consumer's `b64(S)`
/// supplies the art and closes both data URIs.
pub fn art_open() -> ByteArray {
    "</script><script type=\"text/plain\" id=\"art\">"
}

/// `D` for `midi` and `settings`: validates and encodes `settings` (reverting with the
/// `'TS: ...'` panic data of `settings::validate` or `settings::encode`), then appends the MIDI
/// block, the pad and the opening of the art block.
pub fn d_fragment(midi: ByteArray, settings: @SynthSettings) -> ByteArray {
    let mut d = validate_and_encode(settings);
    d.append(@midi_open());
    d.append(@bytes_base64_encode(midi));
    let pad = (9 - (d.len() + ART_OPEN_LEN) % 9) % 9;
    d.append_word(spaces(pad), pad);
    d.append(@art_open());
    d
}

/// `midi_segment(midi, settings) = b64(b64(D))`.
pub fn midi_segment(midi: ByteArray, settings: @SynthSettings) -> ByteArray {
    bytes_base64_encode(bytes_base64_encode(d_fragment(midi, settings)))
}

/// `n` ASCII spaces (`n <= 8`) as one word, for `append_word(spaces(n), n)`.
fn spaces(n: u32) -> felt252 {
    match n {
        0 => 0,
        1 => 0x20,
        2 => 0x2020,
        3 => 0x202020,
        4 => 0x20202020,
        5 => 0x2020202020,
        6 => 0x202020202020,
        7 => 0x20202020202020,
        8 => 0x2020202020202020,
        _ => panic_with_felt252('pad > 8'),
    }
}

#[cfg(test)]
mod tests {
    use crate::settings::default_settings;
    use super::{ART_OPEN_LEN, MIDI_OPEN_LEN, art_open, d_fragment, midi_open, spaces};

    #[test]
    fn tag_lengths() {
        assert_eq!(midi_open().len(), MIDI_OPEN_LEN);
        assert_eq!(art_open().len(), ART_OPEN_LEN);
    }

    #[test]
    fn spaces_words() {
        let mut n = 0;
        while n != 9 {
            let mut ba: ByteArray = "";
            ba.append_word(spaces(n), n);
            let mut expected: ByteArray = "";
            let mut i = 0;
            while i != n {
                expected.append_byte(' ');
                i += 1;
            }
            assert_eq!(ba, expected);
            n += 1;
        }
    }

    // Every pad length 0..=8 occurs as the MIDI grows by one byte at a time (b64 grows by 4 bytes
    // per 3, so 27 consecutive lengths cover every residue of len(D) mod 9).
    #[test]
    fn d_is_9_aligned_for_every_midi_length() {
        let mut midi: ByteArray = "";
        let mut seen: u32 = 0;
        let mut i = 0;
        while i != 27 {
            let d = d_fragment(midi.clone(), @default_settings());
            assert_eq!(d.len() % 9, 0);
            let body = 16 + MIDI_OPEN_LEN + (midi.len() + 2) / 3 * 4 + ART_OPEN_LEN;
            seen = seen | core::num::traits::Pow::pow(2_u32, d.len() - body);
            midi.append_byte(0x90);
            i += 1;
        }
        assert_eq!(seen, 0x1ff);
    }
}
