//! NFT-owned assembly. Own encoder, complete art element, no combined-page re-encoding.
use onchain_midi_player::base64::bytes_base64_encode;
use onchain_midi_player::interface::{ITinySynthDispatcherTrait, ITinySynthLibraryDispatcher};
use onchain_midi_player::types::TinySynthSettings;
use crate::owned_assets;

pub fn align_to_word(ref uri: ByteArray) {
    while uri.len() % 31 != 0 {
        uri.append(@"SUNBZ0lDQWdJQ0Fn");
    }
}
pub fn encode_fragment(mut raw: ByteArray) -> ByteArray {
    while raw.len() % 9 != 0 {
        raw.append_byte(' ');
    }
    bytes_base64_encode(bytes_base64_encode(raw))
}
pub fn token_uri(
    synth: ITinySynthLibraryDispatcher,
    members: ByteArray,
    svg: ByteArray,
    midi: ByteArray,
    settings: TinySynthSettings,
    fixture: ByteArray,
) -> ByteArray {
    let mut image_value = bytes_base64_encode(svg);
    image_value.append_byte('"');
    while image_value.len() % 3 != 0 {
        image_value.append_byte(' ');
    }
    let value_len = image_value.len();
    let image_value_b64 = bytes_base64_encode(image_value);
    let key: ByteArray = "\"image\":\"data:image/svg+xml;base64,";
    let mut open: ByteArray = "{";
    open.append(@members);
    open.append_byte(',');
    while (open.len() + key.len()) % 3 != 0 {
        open.append_byte(' ');
    }
    while (29 + (open.len() + key.len()) / 3 * 4) % 31 != 0 {
        open.append(@"   ");
    }
    open.append(@key);
    let mut uri: ByteArray = "data:application/json;base64,";
    uri.append(@bytes_base64_encode(open));
    uri.append(@image_value_b64);
    uri.append(@"LCAgImFuaW1hdGlvbl91cmwiOiJkYXRhOnRleHQvaHRtbDtiYXNlNjQs");
    uri.append(@owned_assets::head_segment());
    align_to_word(ref uri);
    uri.append(@synth.gunzip_segment());
    align_to_word(ref uri);
    if fixture.len() != 0 {
        align_to_word(ref uri);
        uri.append(@fixture);
    }
    align_to_word(ref uri);
    uri.append(@synth.player_segment());
    uri.append(@owned_assets::body_segment());
    // First HTML layer reuses the metadata image attribute. Prefix is 93 raw bytes so its
    // encoded length is word-aligned; the suffix closes the element before external whitespace.
    let mut inner: ByteArray =
        "PGltZyBpZD0iYmVhc3QtYXJ0IiBhbHQ9IiIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzcmM9ImRhdGE6aW1hZ2Uvc3ZnK3htbDtiYXNlNjQs";
    inner.append(@image_value_b64);
    let mut suffix: ByteArray = ">";
    while (93 + value_len + suffix.len()) % 9 != 0 {
        suffix.append_byte(' ');
    }
    inner.append(@bytes_base64_encode(suffix));
    uri.append(@bytes_base64_encode(inner));
    uri.append(@synth.midi_segment(midi, settings));
    align_to_word(ref uri);
    uri.append(@owned_assets::footer_segment());
    uri.append(@bytes_base64_encode("\"}"));
    uri
}
