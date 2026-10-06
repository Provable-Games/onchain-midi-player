//! Fixed materialization, append and library-call gas measured independently.
use onchain_midi_player::interface::ITinySynthDispatcherTrait;
use onchain_midi_player::segment_data;
use crate::helpers::class;
#[test]
fn gas_materialize_engine() {
    assert!(segment_data::engine_segment().len() > 0);
}
#[test]
fn gas_materialize_loader() {
    assert!(segment_data::gunzip_segment().len() > 0);
}
#[test]
fn gas_materialize_player() {
    assert!(segment_data::player_segment().len() > 0);
}
#[test]
fn gas_append_aligned() {
    let mut out: ByteArray = "";
    out.append(@segment_data::engine_segment());
    out.append(@segment_data::player_segment());
    assert!(out.len() > 0);
}
#[test]
fn gas_append_unaligned() {
    let mut out: ByteArray = "x";
    out.append(@segment_data::engine_segment());
    out.append(@segment_data::player_segment());
    assert!(out.len() > 0);
}
#[test]
fn gas_lc_loader() {
    assert!(class().gunzip_segment().len() > 0);
}
#[test]
fn gas_lc_player() {
    assert!(class().player_segment().len() > 0);
}
