//! `set_repetitions` is owner only, and retunes a token without a redeploy.

use core::panic_with_felt252;
use snforge_std::{start_cheat_caller_address, stop_cheat_caller_address};
use stress_nft::stress_nft::{
    IStressNftDispatcherTrait, IStressNftSafeDispatcher, IStressNftSafeDispatcherTrait,
};
use crate::helpers::{owner, setup};

#[test]
#[feature("safe_dispatcher")]
fn only_the_owner_can_set_repetitions() {
    let (nft, _) = setup();
    let safe = IStressNftSafeDispatcher { contract_address: nft.contract_address };
    let before = nft.repetitions(3);
    let stranger = 'stranger'.try_into().unwrap();
    for caller in array![stranger, nft.contract_address] {
        start_cheat_caller_address(nft.contract_address, caller);
        match safe.set_repetitions(3, 1) {
            Result::Ok(_) => panic_with_felt252('should have reverted'),
            Result::Err(panic_data) => assert(
                *panic_data.at(0) == 'caller is not the owner', 'wrong error',
            ),
        }
        stop_cheat_caller_address(nft.contract_address);
    }
    assert(nft.repetitions(3) == before, 'unchanged');
}

#[test]
fn the_owner_retunes_a_token() {
    let (nft, _) = setup();
    let long = nft.token_uri(3).len();
    start_cheat_caller_address(nft.contract_address, owner());
    nft.set_repetitions(3, 10);
    stop_cheat_caller_address(nft.contract_address);
    assert(nft.repetitions(3) == 10, 'set');
    assert(nft.token_uri(3).len() < long, 'shorter');
    // Other tokens keep their value.
    assert(nft.repetitions(4) != 10, 'others unchanged');
}

#[test]
#[feature("safe_dispatcher")]
fn set_repetitions_checks_its_arguments() {
    let (nft, _) = setup();
    let safe = IStressNftSafeDispatcher { contract_address: nft.contract_address };
    start_cheat_caller_address(nft.contract_address, owner());
    match safe.set_repetitions(3, 0) {
        Result::Ok(_) => panic_with_felt252('should have reverted'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'zero repetitions', 'wrong error'),
    }
    match safe.set_repetitions(21, 5) {
        Result::Ok(_) => panic_with_felt252('should have reverted'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'unknown token', 'wrong error'),
    }
    stop_cheat_caller_address(nft.contract_address);
}
