//! Gas of `validate` and `encode` (`snforge test gas_`). Each input has three tests: `build`
//! (deserializing the fixture only, the baseline), `validate` and `encode`, each including the
//! build; subtract `build` for the cost of the function itself. Results are in the README.

use onchain_tinysynth::settings::{encode, validate};
use crate::settings_fixtures::{
    valid_default, valid_max_count_min_width, valid_max_length, valid_six_timbres,
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
fn gas_32x8_min_width_build() {
    let settings = valid_max_count_min_width();
    assert(settings.timbres.len() == 32, 'timbres');
}

#[test]
fn gas_32x8_min_width_validate() {
    let settings = valid_max_count_min_width();
    validate(@settings);
}

#[test]
fn gas_32x8_min_width_encode() {
    let settings = valid_max_count_min_width();
    assert(encode(@settings).len() == 7437, 'length');
}

#[test]
fn gas_max_length_build() {
    let settings = valid_max_length();
    assert(settings.timbres.len() == 32, 'timbres');
}

#[test]
fn gas_max_length_validate() {
    let settings = valid_max_length();
    validate(@settings);
}

#[test]
fn gas_max_length_encode() {
    let settings = valid_max_length();
    assert(encode(@settings).len() == 8192, 'length');
}
