//! Gas of `validate` and `encode` (`snforge test gas_`). Each input has three tests: `build`
//! (deserializing the fixture only, the baseline), `validate` and `encode`, each including the
//! build; subtract `build` for the cost of the function itself. Results are in the README.

use onchain_tinysynth::settings::{encode, validate};
use crate::settings_fixtures::{
    STRUCTURAL_MAX_LEN, structural_max, valid_default, valid_every_slot, valid_six_timbres,
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
