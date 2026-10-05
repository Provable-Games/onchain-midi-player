//! Gas of token 4's token_uri (a full-size Beast: 22,733-byte SVG, 3,716-byte score, the reference
//! sounds), piece by piece (`snforge test gas_`), in L2 gas, with the class's optimized encoder.
//! Results are in the example's README and docs/gas.md. Each measurement has a baseline that builds
//! its inputs; subtract it.
//!
//! - `gas_t4_token_uri` - `gas_t4_setup`: the whole token_uri, on the deployed NFT.
//! - `gas_t4_segment` - `gas_t4_declare`: `animation_url_segment()` through the library call.
//! - `gas_t4_midi_segment` - `gas_t4_midi_segment_inputs`: `midi_segment` through the library call.
//! - `gas_t4_b64_svg_*` - `gas_t4_svg`: the consumer's `b64(svg)`, through the class's `base64` or
//!   with the same encoder compiled into the consumer (no argument and result serialization).
//! - `gas_t4_b64_s` - `gas_t4_s`: the consumer's `b64(S)` (S = svg_b64 '"' <pad>, 30,315 bytes)
//!   through the library call.
//! - `gas_t4_appends_*` - `gas_t4_append_pieces`: appending every piece of token 4's token_uri
//!   (pieces of the real lengths) in the word-aligned layout the example uses, and in the unaligned
//!   layout without the alignment spaces.

use beast_consumer::beast_data::warlock_svg;
use beast_consumer::beast_like_nft::{IBeastLikeNftDispatcherTrait, comma_b64, image_key_b64};
use beast_consumer::sound;
use onchain_midi_player::base64::bytes_base64_encode;
use onchain_midi_player::interface::{ITinySynthDispatcherTrait, ITinySynthLibraryDispatcher};
use onchain_midi_player::page_data;
use snforge_std::{DeclareResultTrait, declare};
use crate::test_token_uri::setup;

fn synth() -> ITinySynthLibraryDispatcher {
    let class_hash = declare("TinySynth").unwrap().contract_class().class_hash;
    ITinySynthLibraryDispatcher { class_hash }
}

/// `n` bytes of filler: a piece of the right length (append cost depends only on lengths).
fn filler(n: u32) -> ByteArray {
    let mut b: ByteArray = "";
    let mut i = 0;
    while i + 31 <= n {
        b.append_word('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 31);
        i += 31;
    }
    while i != n {
        b.append_byte('A');
        i += 1;
    }
    b
}

// ------------------------------------------------------------------------------------------------
// The whole token_uri
// ------------------------------------------------------------------------------------------------

#[test]
fn gas_t4_setup() {
    let (nft, class_hash) = setup();
    assert(nft.tinysynth_class_hash() == class_hash, 'class hash');
}

#[test]
fn gas_t4_token_uri() {
    let (nft, _) = setup();
    assert(nft.token_uri(4).len() == 144357, 'token_uri length');
}

// ------------------------------------------------------------------------------------------------
// The class's pieces, through the library call
// ------------------------------------------------------------------------------------------------

#[test]
fn gas_t4_declare() {
    let _synth = synth();
}

#[test]
fn gas_t4_segment() {
    assert(synth().animation_url_segment().len() == page_data::SEGMENT_LEN, 'segment');
}

#[test]
fn gas_t4_midi_segment_inputs() {
    let _synth = synth();
    let midi = sound::token_midi(4);
    let settings = sound::token_settings(4, 1);
    assert(midi.len() == 3716 && settings.timbres.len() == 3, 'inputs');
}

#[test]
fn gas_t4_midi_segment() {
    let synth = synth();
    let midi = sound::token_midi(4);
    let settings = sound::token_settings(4, 1);
    assert(synth.midi_segment(midi, settings).len() == 9568, 'midi_segment');
}

// ------------------------------------------------------------------------------------------------
// The consumer's base64 work
// ------------------------------------------------------------------------------------------------

#[test]
fn gas_t4_svg() {
    let _synth = synth();
    assert(warlock_svg().len() == 22733, 'svg');
}

#[test]
fn gas_t4_b64_svg_library_call() {
    let synth = synth();
    assert(synth.base64(warlock_svg()).len() == 30312, 'b64(svg)');
}

#[test]
fn gas_t4_b64_svg_compiled_in() {
    let _synth = synth();
    assert(bytes_base64_encode(warlock_svg()).len() == 30312, 'b64(svg)');
}

#[test]
fn gas_t4_s() {
    let _synth = synth();
    assert(filler(30315).len() == 30315, 'S');
}

#[test]
fn gas_t4_b64_s() {
    let synth = synth();
    assert(synth.base64(filler(30315)).len() == 40420, 'b64(S)');
}

// ------------------------------------------------------------------------------------------------
// The appends: word-aligned and unaligned layouts
// ------------------------------------------------------------------------------------------------

/// Token 4's pieces at their real lengths: b64('{' members ',' <pad>) (308), b64(head) of the
/// unaligned layout (356), b64(S) (40,420), the segment (53,476) and midi_segment (9,568).
fn pieces() -> (ByteArray, ByteArray, ByteArray, ByteArray, ByteArray) {
    (filler(308), filler(356), filler(40420), page_data::animation_url_segment(), filler(9568))
}

#[test]
fn gas_t4_append_pieces() {
    let (open, head, s_b64, segment, ms) = pieces();
    assert(open.len() + head.len() + s_b64.len() + segment.len() + ms.len() == 104128, 'pieces');
}

/// The example's layout: b64(S) at byte 465 and the segment at byte 40,889, both multiples of 31.
#[test]
fn gas_t4_appends_aligned() {
    let (open, _head, s_b64, segment, ms) = pieces();
    let mut uri: ByteArray = "data:application/json;base64,";
    uri.append(@open);
    let image_key = image_key_b64();
    while (uri.len() + image_key.len()) % 31 != 0 {
        uri.append(@"ICAg");
    }
    uri.append(@image_key);
    assert(uri.len() % 31 == 0, 'b64(S) aligned');
    uri.append(@s_b64);
    uri.append(@comma_b64());
    while uri.len() % 31 != 0 {
        uri.append(@"ICAg");
    }
    uri.append(@segment);
    uri.append(@ms);
    uri.append(@s_b64);
    uri.append(@"fQ==");
    assert(uri.len() == 144357, 'token_uri length');
}

/// The same pieces without the alignment spaces (the layout before word alignment).
#[test]
fn gas_t4_appends_unaligned() {
    let (_open, head, s_b64, segment, ms) = pieces();
    let mut uri: ByteArray = "data:application/json;base64,";
    uri.append(@head);
    assert(uri.len() % 31 != 0, 'b64(S) unaligned');
    uri.append(@s_b64);
    uri.append(@comma_b64());
    assert(uri.len() % 31 != 0, 'segment unaligned');
    uri.append(@segment);
    uri.append(@ms);
    uri.append(@s_b64);
    uri.append(@"fQ==");
    assert(uri.len() == 144277, 'token_uri length');
}
