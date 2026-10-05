//! Gas of `validate` and `encode` (`snforge test gas_`). Each input has three tests: `build`
//! (deserializing the fixture only, the baseline), `validate` and `encode`, each including the
//! build; subtract `build` for the cost of the function itself. Results are in the README.

use onchain_midi_player::settings::{encode, validate};
use crate::settings_fixtures::{
    LONG_LFSR_LEN, STRUCTURAL_MAX_LEN, long_lfsr, structural_max, valid_default, valid_every_slot,
    valid_filters, valid_one_filter, valid_one_wave, valid_reference_waves, valid_six_timbres,
    valid_waves_256,
};


#[test]
fn gas_0_timbres_build() {
    let settings = valid_default();
    assert(settings.timbres.len() == 0, 'timbres');
}

#[test]
fn gas_0_timbres_validate() {
    let settings = valid_default();
    validate(@settings);
}

#[test]
fn gas_0_timbres_encode() {
    let settings = valid_default();
    assert(encode(@settings).len() == 16, 'length');
}

#[test]
fn gas_6_timbres_build() {
    let settings = valid_six_timbres();
    assert(settings.timbres.len() == 6, 'timbres');
}

#[test]
fn gas_6_timbres_validate() {
    let settings = valid_six_timbres();
    validate(@settings);
}

#[test]
fn gas_6_timbres_encode() {
    let settings = valid_six_timbres();
    assert(encode(@settings).len() == 504, 'length');
}

#[test]
fn gas_every_slot_build() {
    let settings = valid_every_slot();
    assert(settings.timbres.len() == 175, 'timbres');
}

#[test]
fn gas_every_slot_validate() {
    let settings = valid_every_slot();
    validate(@settings);
}

#[test]
fn gas_every_slot_encode() {
    let settings = valid_every_slot();
    assert(encode(@settings).len() == 9836, 'length');
}

#[test]
fn gas_structural_max_build() {
    let settings = structural_max();
    assert(settings.timbres.len() == 175, 'timbres');
}

#[test]
fn gas_structural_max_validate() {
    let settings = structural_max();
    validate(@settings);
}

#[test]
fn gas_structural_max_encode() {
    let settings = structural_max();
    assert(encode(@settings).len() == STRUCTURAL_MAX_LEN, 'length');
}

// Custom waves (issue #2): one, several (the reference waves), 256, and one long table.

#[test]
fn gas_one_wave_build() {
    let settings = valid_one_wave();
    assert(settings.waves.len() == 1, 'waves');
}

#[test]
fn gas_one_wave_validate() {
    let settings = valid_one_wave();
    validate(@settings);
}

#[test]
fn gas_one_wave_encode() {
    let settings = valid_one_wave();
    assert(encode(@settings).len() == 365, 'length');
}

#[test]
fn gas_reference_waves_build() {
    let settings = valid_reference_waves();
    assert(settings.waves.len() == 6, 'waves');
}

#[test]
fn gas_reference_waves_validate() {
    let settings = valid_reference_waves();
    validate(@settings);
}

#[test]
fn gas_reference_waves_encode() {
    let settings = valid_reference_waves();
    assert(encode(@settings).len() == 1356, 'length');
}

#[test]
fn gas_waves_256_build() {
    let settings = valid_waves_256();
    assert(settings.waves.len() == 256, 'waves');
}

#[test]
fn gas_waves_256_validate() {
    let settings = valid_waves_256();
    validate(@settings);
}

#[test]
fn gas_waves_256_encode() {
    let settings = valid_waves_256();
    assert(encode(@settings).len() == 9472, 'length');
}

#[test]
fn gas_long_lfsr_build() {
    let settings = long_lfsr();
    assert(settings.waves.len() == 1, 'waves');
}

#[test]
fn gas_long_lfsr_validate() {
    let settings = long_lfsr();
    validate(@settings);
}

#[test]
fn gas_long_lfsr_encode() {
    let settings = long_lfsr();
    assert(encode(@settings).len() == LONG_LFSR_LEN, 'length');
}

// Filters (issue #3): one (the reference lead's carrier low-passed) and several (six filtered
// outputs).

#[test]
fn gas_one_filter_build() {
    let settings = valid_one_filter();
    assert(settings.timbres.len() == 3, 'timbres');
}

#[test]
fn gas_one_filter_validate() {
    let settings = valid_one_filter();
    validate(@settings);
}

#[test]
fn gas_one_filter_encode() {
    let settings = valid_one_filter();
    assert(encode(@settings).len() == 349, 'length');
}

#[test]
fn gas_filters_build() {
    let settings = valid_filters();
    assert(settings.timbres.len() == 6, 'timbres');
}

#[test]
fn gas_filters_validate() {
    let settings = valid_filters();
    validate(@settings);
}

#[test]
fn gas_filters_encode() {
    let settings = valid_filters();
    assert(encode(@settings).len() == 465, 'length');
}
