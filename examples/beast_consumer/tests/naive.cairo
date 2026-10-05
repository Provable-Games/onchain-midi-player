//! Naive reference: the token JSON built plainly as one string, with standard nested data URIs,
//! then base64-encoded once. No splicing and no pre-encoded pieces.
//!
//! It uses its own table-based, byte-at-a-time encoder (not the class's), and the raw PAGE from
//! the generated golden file (the class only stores PAGE pre-encoded). The whitespace between
//! JSON tokens is the same insignificant whitespace the contract uses for alignment, computed here
//! from lengths alone; scripts/gen_fixtures.mjs checks that the decoded JSON equals the compact
//! JSON.

use beast_consumer::beast_like_nft::{members, token_data, token_svg};
use beast_consumer::sound;
use onchain_midi_player::settings::encode;
use crate::golden;

fn alphabet() -> Span<u8> {
    let s: ByteArray = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out: Array<u8> = array![];
    let mut i = 0;
    while i != s.len() {
        out.append(s[i]);
        i += 1;
    }
    out.span()
}

/// Plain RFC 4648 base64, one output byte at a time.
pub fn naive_b64(data: @ByteArray) -> ByteArray {
    let t = alphabet();
    let mut out: ByteArray = "";
    let len = data.len();
    let mut i = 0;
    while i < len {
        let b0: u32 = data[i].into();
        let b1: u32 = if i + 1 < len {
            data[i + 1].into()
        } else {
            0
        };
        let b2: u32 = if i + 2 < len {
            data[i + 2].into()
        } else {
            0
        };
        out.append_byte(*t[b0 / 4]);
        out.append_byte(*t[(b0 % 4) * 16 + b1 / 16]);
        if i + 1 < len {
            out.append_byte(*t[(b1 % 16) * 4 + b2 / 64]);
        } else {
            out.append_byte('=');
        }
        if i + 2 < len {
            out.append_byte(*t[b2 % 64]);
        } else {
            out.append_byte('=');
        }
        i += 3;
    }
    out
}

fn spaces(n: usize) -> ByteArray {
    let mut s: ByteArray = "";
    let mut i = 0;
    while i != n {
        s.append_byte(' ');
        i += 1;
    }
    s
}

/// The decoded animation_url page: PAGE ++ D ++ SVG.
pub fn naive_animation_html(token_id: u256) -> ByteArray {
    let (name, tier) = token_data(token_id);
    let midi_open: ByteArray = "</script><script type=\"text/plain\" id=\"midi\">";
    let art_open: ByteArray = "</script><script type=\"text/plain\" id=\"art\">";
    let mut d = encode(@sound::token_settings(token_id, tier));
    d.append(@midi_open);
    d.append(@naive_b64(@sound::token_midi(token_id)));
    d.append(@spaces((9 - (d.len() + art_open.len()) % 9) % 9));
    d.append(@art_open);
    let mut html = golden::page();
    html.append(@d);
    html.append(@token_svg(token_id, @name, tier));
    html
}

/// Length of the base64 of `n` bytes, `n` a multiple of 3.
fn b64_len(n: usize) -> usize {
    n / 3 * 4
}

/// The whole token JSON as one plain string.
pub fn naive_token_json(token_id: u256) -> ByteArray {
    let (name, tier) = token_data(token_id);
    let svg_b64 = naive_b64(@token_svg(token_id, @name, tier));
    let image_key: ByteArray = "\"image\":\"data:image/svg+xml;base64,";
    let mut json: ByteArray = "{";
    json.append(@members(token_id, @name, tier));
    json.append_byte(',');
    // The head's spaces: to a multiple of 3, one before the image key, then 3 at a time until the
    // first b64(S) starts on a 31-byte word of the token_uri (29 is the data URI prefix).
    let mut head_pad = (3 - json.len() % 3) % 3 + 1;
    while (29 + b64_len(json.len() + head_pad + image_key.len())) % 31 != 0 {
        head_pad += 3;
    }
    json.append(@spaces(head_pad));
    json.append(@image_key);
    let head_len = json.len();
    json.append(@svg_b64);
    json.append_byte('"');
    let s_pad = spaces((3 - (svg_b64.len() + 1) % 3) % 3);
    json.append(@s_pad);
    // ',' and 2 spaces, then 3 at a time until the segment starts on a word.
    let s_len = svg_b64.len() + 1 + s_pad.len();
    let mut comma: ByteArray = ",  ";
    while (29 + b64_len(head_len) + b64_len(s_len) + b64_len(comma.len())) % 31 != 0 {
        comma.append(@"   ");
    }
    json.append(@comma);
    json.append(@"\"animation_url\":\"data:text/html;base64,");
    json.append(@naive_b64(@naive_animation_html(token_id)));
    json.append_byte('"');
    json.append(@s_pad);
    json.append_byte('}');
    json
}

pub fn naive_token_uri(token_id: u256) -> ByteArray {
    let mut uri: ByteArray = "data:application/json;base64,";
    uri.append(@naive_b64(@naive_token_json(token_id)));
    uri
}
