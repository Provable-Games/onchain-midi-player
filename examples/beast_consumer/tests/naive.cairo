//! Runtime full-page encoder comparison. Fixed raw fragments plus generated token pieces.
use beast_consumer::beast_like_nft::{members, token_data, token_svg};
use beast_consumer::sound;
use onchain_midi_player::base64::bytes_base64_encode;
use onchain_midi_player::segment::d_fragment;
use crate::golden;
pub fn naive_b64(data: @ByteArray) -> ByteArray {
    bytes_base64_encode(data.clone())
}
fn append(ref html: ByteArray, ref length: u32, raw: @ByteArray) {
    html.append(raw);
    length += raw.len() * 16 / 9;
}
fn align(ref html: ByteArray, ref length: u32) {
    while length % 31 != 0 {
        html.append(@"         ");
        length += 16;
    }
}
pub fn naive_token_uri(token_id: u256) -> ByteArray {
    let (name, tier) = token_data(token_id);
    let svg = token_svg(token_id, @name, tier);
    let mut image_value = bytes_base64_encode(svg);
    image_value.append_byte('"');
    while image_value.len() % 3 != 0 {
        image_value.append_byte(' ');
    }
    let key: ByteArray = "\"image\":\"data:image/svg+xml;base64,";
    let mut open: ByteArray = "{";
    open.append(@members(token_id, @name, tier));
    open.append_byte(',');
    while (open.len() + key.len()) % 3 != 0 {
        open.append_byte(' ');
    }
    while (29 + (open.len() + key.len()) / 3 * 4) % 31 != 0 {
        open.append(@"   ");
    }
    open.append(@key);
    open.append(@image_value);
    open.append(@",  \"animation_url\":\"data:text/html;base64,");
    let mut length = 29 + open.len() / 3 * 4;
    let mut html: ByteArray = "";
    append(ref html, ref length, @golden::head());
    align(ref html, ref length);
    append(ref html, ref length, @golden::gunzip());
    align(ref html, ref length);
    append(ref html, ref length, @golden::engine());
    align(ref html, ref length);
    append(ref html, ref length, @golden::player());
    append(ref html, ref length, @golden::body());
    let mut art: ByteArray =
        "<img id=\"beast-art\" alt=\"\"                                    src=\"data:image/svg+xml;base64,";
    art.append(@image_value);
    art.append(@">");
    while art.len() % 9 != 0 {
        art.append_byte(' ');
    }
    append(ref html, ref length, @art);
    append(
        ref html,
        ref length,
        @d_fragment(sound::token_midi(token_id), @sound::token_settings(token_id, tier)),
    );
    align(ref html, ref length);
    append(ref html, ref length, @golden::footer());
    open.append(@bytes_base64_encode(html));
    open.append(@"\"}");
    let mut uri: ByteArray = "data:application/json;base64,";
    uri.append(@bytes_base64_encode(open));
    uri
}
