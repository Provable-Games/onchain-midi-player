//! Complete per-token data fragments. Settings validation is onchain; MIDI bytes stay verbatim.
use core::panic_with_felt252;
use crate::base64::bytes_base64_encode;
use crate::settings::validate_and_encode;
use crate::types::TinySynthSettings;

pub fn d_fragment(midi: ByteArray, settings: @TinySynthSettings) -> ByteArray {
    let mut d: ByteArray = "<script type=\"text/plain\" id=\"onchain-midi-settings\">";
    d.append(@validate_and_encode(settings));
    d.append(@"</script><script type=\"text/plain\" id=\"onchain-midi-data\">");
    d.append(@bytes_base64_encode(midi));
    d.append(@"</script>");
    let pad = (9 - d.len() % 9) % 9;
    d.append_word(spaces(pad), pad);
    d
}

/// `midi_segment(midi, settings) = b64(b64(D))`.
pub fn midi_segment(midi: ByteArray, settings: @TinySynthSettings) -> ByteArray {
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
