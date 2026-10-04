//! Gas of the class (`snforge test gas_`), in L2 gas, with the optimized encoder
//! (`game_components_encoding`, see `src/base64.cairo`). Results are in the README.
//!
//! - `gas_lc_*`: each entry point through the library dispatcher on the declared class, the way a
//!   consumer calls it. `gas_lc_declare` is the baseline (declaring only). The figures include
//!   serializing the arguments and the result, which a consumer pays too.
//! - `gas_ms_*`: `midi_segment` across MIDI sizes (no MIDI, then the synthetic scores of 816 to
//!   3,716 bytes, the sizes of the production Beast scores) and `SETTINGS` sizes (16, 334, 504 and
//!   9,836 bytes, and the largest valid input, 156,489 bytes, with no MIDI and with the largest
//!   score only), called directly. Per cell, `build` only builds the inputs (the baseline), `d`
//!   builds `D` (validation, `SETTINGS`, `b64(midi)` and the appends), and `full` is the whole
//!   `midi_segment`; `full - d` is the two outer base64 passes. `gas_b64_midi_*` is `b64(midi)`
//!   alone, net of building the MIDI. `validate` and `encode` alone are in
//!   `test_settings_gas.cairo`.

use onchain_tinysynth::base64::bytes_base64_encode;
use onchain_tinysynth::interface::IOnchainTinySynthDispatcherTrait;
use onchain_tinysynth::segment::{d_fragment, midi_segment};
use onchain_tinysynth::types::SynthSettings;
use crate::class_fixtures::{
    beast_midi_genesis, beast_midi_heaviest, beast_midi_threshold_1, beast_midi_threshold_3,
    beast_midi_veteran, seq_bytes,
};
use crate::helpers::{class, declare_class};
use crate::settings_fixtures::{
    structural_max, valid_beast_reference, valid_default, valid_every_slot, valid_six_timbres,
};

fn midi(i: u32) -> ByteArray {
    match i {
        0 => "",
        1 => beast_midi_genesis(),
        2 => beast_midi_threshold_1(),
        3 => beast_midi_threshold_3(),
        4 => beast_midi_veteran(),
        _ => beast_midi_heaviest(),
    }
}

fn settings(j: u32) -> SynthSettings {
    match j {
        0 => valid_default(),
        1 => valid_beast_reference(),
        2 => valid_six_timbres(),
        3 => valid_every_slot(),
        _ => structural_max(),
    }
}

fn build(i: u32, j: u32) {
    let m = midi(i);
    let s = settings(j);
    assert(m.len() < 4000 && s.timbres.len() <= 175, 'inputs');
}

fn d(i: u32, j: u32) {
    let m = midi(i);
    let s = settings(j);
    assert(d_fragment(m, @s).len() % 9 == 0, 'D');
}

fn full(i: u32, j: u32) {
    let m = midi(i);
    let s = settings(j);
    assert(midi_segment(m, @s).len() > 0, 'midi_segment');
}

// ------------------------------------------------------------------------------------------------
// Entry points through the library call
// ------------------------------------------------------------------------------------------------

#[test]
fn gas_lc_declare() {
    let _class_hash = declare_class();
}

#[test]
fn gas_lc_animation_url_segment() {
    assert(class().animation_url_segment().len() == 52580, 'segment');
}

#[test]
fn gas_lc_midi_segment_default_no_midi() {
    let s = valid_default();
    assert(class().midi_segment("", s).len() > 0, 'midi_segment');
}

#[test]
fn gas_lc_midi_segment_beast_heaviest() {
    let m = beast_midi_heaviest();
    let s = valid_beast_reference();
    assert(class().midi_segment(m, s).len() > 0, 'midi_segment');
}

#[test]
fn gas_lc_midi_segment_max_heaviest() {
    let m = beast_midi_heaviest();
    let s = structural_max();
    assert(class().midi_segment(m, s).len() > 0, 'midi_segment');
}

#[test]
fn gas_lc_base64_3() {
    assert(class().base64(",  ") == "LCAg", 'base64');
}

#[test]
fn gas_lc_base64_1k_build() {
    let _class_hash = declare_class();
    assert(seq_bytes(1023).len() == 1023, 'input');
}

#[test]
fn gas_lc_base64_1k() {
    let synth = class();
    assert(synth.base64(seq_bytes(1023)).len() == 1364, 'base64');
}

#[test]
fn gas_lc_script_sha256() {
    assert(class().script_sha256() != 0, 'script_sha256');
}

#[test]
fn gas_lc_version() {
    assert(class().version() != 0, 'version');
}

#[test]
fn gas_lc_license() {
    assert(class().license().len() == 8389, 'license');
}

// ------------------------------------------------------------------------------------------------
// b64(midi) alone
// ------------------------------------------------------------------------------------------------

#[test]
fn gas_b64_midi_genesis_build() {
    assert(midi(1).len() == 816, 'midi');
}

#[test]
fn gas_b64_midi_genesis() {
    assert(bytes_base64_encode(midi(1)).len() == 1088, 'b64');
}

#[test]
fn gas_b64_midi_threshold_1_build() {
    assert(midi(2).len() == 1541, 'midi');
}

#[test]
fn gas_b64_midi_threshold_1() {
    assert(bytes_base64_encode(midi(2)).len() == 2056, 'b64');
}

#[test]
fn gas_b64_midi_threshold_3_build() {
    assert(midi(3).len() == 2266, 'midi');
}

#[test]
fn gas_b64_midi_threshold_3() {
    assert(bytes_base64_encode(midi(3)).len() == 3024, 'b64');
}

#[test]
fn gas_b64_midi_veteran_build() {
    assert(midi(4).len() == 2991, 'midi');
}

#[test]
fn gas_b64_midi_veteran() {
    assert(bytes_base64_encode(midi(4)).len() == 3988, 'b64');
}

#[test]
fn gas_b64_midi_heaviest_build() {
    assert(midi(5).len() == 3716, 'midi');
}

#[test]
fn gas_b64_midi_heaviest() {
    assert(bytes_base64_encode(midi(5)).len() == 4956, 'b64');
}

// ------------------------------------------------------------------------------------------------
// midi_segment: MIDI size x SETTINGS size
// ------------------------------------------------------------------------------------------------

#[test]
fn gas_ms_empty_default_build() {
    build(0, 0);
}

#[test]
fn gas_ms_empty_default_d() {
    d(0, 0);
}

#[test]
fn gas_ms_empty_default_full() {
    full(0, 0);
}

#[test]
fn gas_ms_empty_beast_build() {
    build(0, 1);
}

#[test]
fn gas_ms_empty_beast_d() {
    d(0, 1);
}

#[test]
fn gas_ms_empty_beast_full() {
    full(0, 1);
}

#[test]
fn gas_ms_empty_six_build() {
    build(0, 2);
}

#[test]
fn gas_ms_empty_six_d() {
    d(0, 2);
}

#[test]
fn gas_ms_empty_six_full() {
    full(0, 2);
}

#[test]
fn gas_ms_empty_slots_build() {
    build(0, 3);
}

#[test]
fn gas_ms_empty_slots_d() {
    d(0, 3);
}

#[test]
fn gas_ms_empty_slots_full() {
    full(0, 3);
}

#[test]
fn gas_ms_empty_max_build() {
    build(0, 4);
}

#[test]
fn gas_ms_empty_max_d() {
    d(0, 4);
}

#[test]
fn gas_ms_empty_max_full() {
    full(0, 4);
}

#[test]
fn gas_ms_genesis_default_build() {
    build(1, 0);
}

#[test]
fn gas_ms_genesis_default_d() {
    d(1, 0);
}

#[test]
fn gas_ms_genesis_default_full() {
    full(1, 0);
}

#[test]
fn gas_ms_genesis_beast_build() {
    build(1, 1);
}

#[test]
fn gas_ms_genesis_beast_d() {
    d(1, 1);
}

#[test]
fn gas_ms_genesis_beast_full() {
    full(1, 1);
}

#[test]
fn gas_ms_genesis_six_build() {
    build(1, 2);
}

#[test]
fn gas_ms_genesis_six_d() {
    d(1, 2);
}

#[test]
fn gas_ms_genesis_six_full() {
    full(1, 2);
}

#[test]
fn gas_ms_genesis_slots_build() {
    build(1, 3);
}

#[test]
fn gas_ms_genesis_slots_d() {
    d(1, 3);
}

#[test]
fn gas_ms_genesis_slots_full() {
    full(1, 3);
}

#[test]
fn gas_ms_threshold_1_default_build() {
    build(2, 0);
}

#[test]
fn gas_ms_threshold_1_default_d() {
    d(2, 0);
}

#[test]
fn gas_ms_threshold_1_default_full() {
    full(2, 0);
}

#[test]
fn gas_ms_threshold_1_beast_build() {
    build(2, 1);
}

#[test]
fn gas_ms_threshold_1_beast_d() {
    d(2, 1);
}

#[test]
fn gas_ms_threshold_1_beast_full() {
    full(2, 1);
}

#[test]
fn gas_ms_threshold_1_six_build() {
    build(2, 2);
}

#[test]
fn gas_ms_threshold_1_six_d() {
    d(2, 2);
}

#[test]
fn gas_ms_threshold_1_six_full() {
    full(2, 2);
}

#[test]
fn gas_ms_threshold_1_slots_build() {
    build(2, 3);
}

#[test]
fn gas_ms_threshold_1_slots_d() {
    d(2, 3);
}

#[test]
fn gas_ms_threshold_1_slots_full() {
    full(2, 3);
}

#[test]
fn gas_ms_threshold_3_default_build() {
    build(3, 0);
}

#[test]
fn gas_ms_threshold_3_default_d() {
    d(3, 0);
}

#[test]
fn gas_ms_threshold_3_default_full() {
    full(3, 0);
}

#[test]
fn gas_ms_threshold_3_beast_build() {
    build(3, 1);
}

#[test]
fn gas_ms_threshold_3_beast_d() {
    d(3, 1);
}

#[test]
fn gas_ms_threshold_3_beast_full() {
    full(3, 1);
}

#[test]
fn gas_ms_threshold_3_six_build() {
    build(3, 2);
}

#[test]
fn gas_ms_threshold_3_six_d() {
    d(3, 2);
}

#[test]
fn gas_ms_threshold_3_six_full() {
    full(3, 2);
}

#[test]
fn gas_ms_threshold_3_slots_build() {
    build(3, 3);
}

#[test]
fn gas_ms_threshold_3_slots_d() {
    d(3, 3);
}

#[test]
fn gas_ms_threshold_3_slots_full() {
    full(3, 3);
}

#[test]
fn gas_ms_veteran_default_build() {
    build(4, 0);
}

#[test]
fn gas_ms_veteran_default_d() {
    d(4, 0);
}

#[test]
fn gas_ms_veteran_default_full() {
    full(4, 0);
}

#[test]
fn gas_ms_veteran_beast_build() {
    build(4, 1);
}

#[test]
fn gas_ms_veteran_beast_d() {
    d(4, 1);
}

#[test]
fn gas_ms_veteran_beast_full() {
    full(4, 1);
}

#[test]
fn gas_ms_veteran_six_build() {
    build(4, 2);
}

#[test]
fn gas_ms_veteran_six_d() {
    d(4, 2);
}

#[test]
fn gas_ms_veteran_six_full() {
    full(4, 2);
}

#[test]
fn gas_ms_veteran_slots_build() {
    build(4, 3);
}

#[test]
fn gas_ms_veteran_slots_d() {
    d(4, 3);
}

#[test]
fn gas_ms_veteran_slots_full() {
    full(4, 3);
}

#[test]
fn gas_ms_heaviest_default_build() {
    build(5, 0);
}

#[test]
fn gas_ms_heaviest_default_d() {
    d(5, 0);
}

#[test]
fn gas_ms_heaviest_default_full() {
    full(5, 0);
}

#[test]
fn gas_ms_heaviest_beast_build() {
    build(5, 1);
}

#[test]
fn gas_ms_heaviest_beast_d() {
    d(5, 1);
}

#[test]
fn gas_ms_heaviest_beast_full() {
    full(5, 1);
}

#[test]
fn gas_ms_heaviest_six_build() {
    build(5, 2);
}

#[test]
fn gas_ms_heaviest_six_d() {
    d(5, 2);
}

#[test]
fn gas_ms_heaviest_six_full() {
    full(5, 2);
}

#[test]
fn gas_ms_heaviest_slots_build() {
    build(5, 3);
}

#[test]
fn gas_ms_heaviest_slots_d() {
    d(5, 3);
}

#[test]
fn gas_ms_heaviest_slots_full() {
    full(5, 3);
}

#[test]
fn gas_ms_heaviest_max_build() {
    build(5, 4);
}

#[test]
fn gas_ms_heaviest_max_d() {
    d(5, 4);
}

#[test]
fn gas_ms_heaviest_max_full() {
    full(5, 4);
}
