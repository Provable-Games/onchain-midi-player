//! End to end: the real class is declared but never deployed, StressNft is deployed with its class
//! hash, and token_uri (built with library calls) is checked against the independent JavaScript
//! reference by length and SHA-256: a small token and a large one. Also the token table, the
//! score and the engine check.

use core::panic_with_felt252;
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use stress_nft::repetitions::default_repetitions;
use stress_nft::stress_nft::{
    IStressNftDispatcherTrait, IStressNftSafeDispatcher, IStressNftSafeDispatcherTrait, TOKEN_COUNT,
    render_svg, stress_midi,
};
use crate::golden;
use crate::helpers::{owner, setup, sha256};

#[test]
fn token_uri_1_matches_js_digest() {
    let (nft, _) = setup();
    let uri = nft.token_uri(1);
    let (len, digest) = golden::token_uri_1_digest();
    assert(uri.len() == len, 'token 1 length');
    assert(sha256(@uri) == digest, 'token 1 sha256');
}

#[test]
fn token_uri_12_matches_js_digest() {
    let (nft, _) = setup();
    let uri = nft.token_uri(12);
    let (len, digest) = golden::token_uri_12_digest();
    assert(uri.len() == len, 'token 12 length');
    assert(sha256(@uri) == digest, 'token 12 sha256');
}

#[test]
fn token_table_is_stored() {
    let (nft, class_hash) = setup();
    assert(nft.tinysynth_class_hash() == class_hash, 'class hash');
    assert(nft.owner() == owner(), 'owner');
    let mut token = 1;
    while token <= TOKEN_COUNT {
        assert(nft.repetitions(token.into()) == default_repetitions(token), 'table');
        token += 1;
    }
    assert(default_repetitions(1) < default_repetitions(TOKEN_COUNT), 'grows');
}

#[test]
fn score_length_grows_by_64_bytes_per_bar() {
    assert(stress_midi(1).len() == 48 + 64, 'one bar');
    assert(stress_midi(100).len() == 48 + 64 * 100, 'a hundred bars');
}

#[test]
fn art_never_contains_a_script_end_tag() {
    // Every literal of the SVG is fixed and the rest is digits, so this holds for every token.
    let svg = render_svg(20, 10040);
    let mut i = 0;
    while i + 8 <= svg.len() {
        let mut same = true;
        let mut j = 0;
        let tag: ByteArray = "</script";
        while j != 8 {
            if (svg[i + j] | 0x20) != (tag[j] | 0x20) {
                same = false;
                break;
            }
            j += 1;
        }
        assert(!same, 'SVG has </script');
        i += 1;
    }
}

/// A class of another engine: it answers `engine()`, but not with `'tinysynth'`.
#[starknet::contract]
mod OtherEngineClass {
    #[storage]
    struct Storage {}

    #[external(v0)]
    fn engine(self: @ContractState) -> felt252 {
        'other'
    }
}

#[test]
fn constructor_rejects_another_engines_class() {
    let other = declare("OtherEngineClass").unwrap().contract_class().class_hash;
    let args = array![other.into(), owner().into()];
    match declare("StressNft").unwrap().contract_class().deploy(@args) {
        Result::Ok(_) => panic_with_felt252('should have reverted'),
        Result::Err(panic_data) => assert(
            *panic_data.at(0) == 'not a TinySynth class', 'wrong error',
        ),
    }
}

#[test]
#[feature("safe_dispatcher")]
fn unknown_tokens_revert() {
    let (nft, _) = setup();
    let nft = IStressNftSafeDispatcher { contract_address: nft.contract_address };
    for token in array![0_u256, 21, 99, 0x100000000000000000000000000000001] {
        match nft.token_uri(token) {
            Result::Ok(_) => panic_with_felt252('should have reverted'),
            Result::Err(panic_data) => assert(*panic_data.at(0) == 'unknown token', 'wrong error'),
        }
        match nft.repetitions(token) {
            Result::Ok(_) => panic_with_felt252('should have reverted'),
            Result::Err(panic_data) => assert(*panic_data.at(0) == 'unknown token', 'wrong error'),
        }
    }
}
