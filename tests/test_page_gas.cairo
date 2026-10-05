//! Gas of materializing `animation_url_segment()` and of appending it to a consumer's `ByteArray`
//! (`snforge test gas_segment`). `fetch` only materializes the constant (the baseline); the
//! `append` tests add appending it after a 31-byte prefix (word-aligned: the destination has no
//! pending bytes, so whole words are copied) and after the 29-byte `data:application/json;base64,`
//! (unaligned: every word is split across two). Subtract `fetch` for the cost of the append itself.
//! Results are in docs/gas.md and docs/token-uri-layout.md.

use onchain_midi_player::page_data;

#[test]
fn gas_segment_fetch() {
    let segment = page_data::animation_url_segment();
    assert(segment.len() == page_data::SEGMENT_LEN, 'length');
}

#[test]
fn gas_segment_append_aligned() {
    let segment = page_data::animation_url_segment();
    let mut uri: ByteArray = "data:application/json;base64,ey";
    assert(uri.len() == 31, 'prefix');
    uri.append(@segment);
    assert(uri.len() == 31 + page_data::SEGMENT_LEN, 'length');
}

#[test]
fn gas_segment_append_unaligned() {
    let segment = page_data::animation_url_segment();
    let mut uri: ByteArray = "data:application/json;base64,";
    assert(uri.len() == 29, 'prefix');
    uri.append(@segment);
    assert(uri.len() == 29 + page_data::SEGMENT_LEN, 'length');
}
