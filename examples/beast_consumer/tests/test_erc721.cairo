//! BeastLikeNft is a standard OpenZeppelin ERC721: SRC5 interface IDs, the constructor's tokens,
//! transfers, the metadata `token_uri`/`tokenURI` and its revert for a token that does not exist,
//! and the open test `mint`.

use beast_consumer::beast_like_nft::{
    IBeastLikeNftDispatcher, IBeastLikeNftDispatcherTrait, IBeastLikeNftSafeDispatcher,
    IBeastLikeNftSafeDispatcherTrait,
};
use core::panic_with_felt252;
use openzeppelin_interfaces::erc721::{
    ERC721ABIDispatcher, ERC721ABIDispatcherTrait, ERC721ABISafeDispatcher,
    ERC721ABISafeDispatcherTrait, IERC721_ID, IERC721_METADATA_ID,
};
use openzeppelin_interfaces::introspection::ISRC5_ID;
use snforge_std::{start_cheat_caller_address, stop_cheat_caller_address};
use starknet::ContractAddress;
use crate::golden;
use crate::test_token_uri::{deploy, recipient, sha256};

fn erc721() -> (ERC721ABIDispatcher, ContractAddress) {
    let (address, _) = deploy();
    (ERC721ABIDispatcher { contract_address: address }, address)
}

fn other() -> ContractAddress {
    'other'.try_into().unwrap()
}

#[test]
fn supports_erc721_metadata_and_src5() {
    let (nft, _) = erc721();
    assert(nft.supports_interface(IERC721_ID), 'IERC721');
    assert(nft.supports_interface(IERC721_METADATA_ID), 'IERC721Metadata');
    assert(nft.supports_interface(ISRC5_ID), 'ISRC5');
    assert(!nft.supports_interface(0x123), 'unknown interface');
}

#[test]
fn name_and_symbol() {
    let (nft, _) = erc721();
    assert(nft.name() == "Beast-like Example", 'name');
    assert(nft.symbol() == "BEASTX", 'symbol');
}

#[test]
fn constructor_mints_tokens_1_to_4_to_the_recipient() {
    let (nft, _) = erc721();
    for token_id in 1..5_u8 {
        assert(nft.owner_of(token_id.into()) == recipient(), 'owner');
    }
    assert(nft.balance_of(recipient()) == 4, 'balance');
}

#[test]
fn transfer_moves_ownership() {
    let (nft, address) = erc721();
    start_cheat_caller_address(address, recipient());
    nft.transfer_from(recipient(), other(), 2);
    stop_cheat_caller_address(address);
    assert(nft.owner_of(2) == other(), 'new owner');
    assert(nft.balance_of(recipient()) == 3, 'sender balance');
    assert(nft.balance_of(other()) == 1, 'receiver balance');
    // The document is the token's, not its owner's.
    assert(nft.token_uri(2) == golden::token_uri_2(), 'token_uri after transfer');
}

#[test]
#[feature("safe_dispatcher")]
fn transfer_by_a_non_owner_reverts() {
    let (address, _) = deploy();
    let nft = ERC721ABISafeDispatcher { contract_address: address };
    start_cheat_caller_address(address, other());
    match nft.transfer_from(recipient(), other(), 1) {
        Result::Ok(_) => panic_with_felt252('should have reverted'),
        Result::Err(panic_data) => assert(
            *panic_data.at(0) == 'ERC721: unauthorized caller', 'wrong error',
        ),
    }
}

/// `tokenURI` is the same document as `token_uri`.
#[test]
fn camel_case_token_uri_matches() {
    let (nft, _) = erc721();
    assert(nft.tokenURI(1) == golden::token_uri_1(), 'tokenURI != golden');
}

#[test]
#[feature("safe_dispatcher")]
fn token_uri_of_a_token_that_does_not_exist_reverts() {
    let (address, _) = deploy();
    let nft = ERC721ABISafeDispatcher { contract_address: address };
    for token_id in array![0_u256, 5, 99].span() {
        match nft.token_uri(*token_id) {
            Result::Ok(_) => panic_with_felt252('should have reverted'),
            Result::Err(panic_data) => assert(
                *panic_data.at(0) == 'ERC721: invalid token ID', 'wrong error',
            ),
        }
    }
    match nft.tokenURI(99) {
        Result::Ok(_) => panic_with_felt252('should have reverted'),
        Result::Err(panic_data) => assert(
            *panic_data.at(0) == 'ERC721: invalid token ID', 'wrong error',
        ),
    }
}

/// Anyone can mint a new Beast, and its token_uri is the JS reference's (`MINTED` in
/// scripts/reference.mjs).
#[test]
fn anyone_can_mint_a_beast_and_it_renders() {
    let (nft, address) = erc721();
    start_cheat_caller_address(address, other());
    IBeastLikeNftDispatcher { contract_address: address }.mint(other(), 5, "Kraken", 4);
    stop_cheat_caller_address(address);
    assert(nft.owner_of(5) == other(), 'owner');
    assert(nft.balance_of(other()) == 1, 'balance');
    let uri = nft.token_uri(5);
    assert((uri.len(), sha256(@uri)) == golden::minted_token_uri_digest(), 'minted != digest');
}

#[feature("safe_dispatcher")]
fn assert_mint_reverts(token_id: u256, name: ByteArray, tier: u8, expected: felt252) {
    let (address, _) = deploy();
    let nft = IBeastLikeNftSafeDispatcher { contract_address: address };
    match nft.mint(other(), token_id, name, tier) {
        Result::Ok(_) => panic_with_felt252('should have reverted'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == expected, *panic_data.at(0)),
    }
}

#[test]
fn minting_an_existing_token_reverts() {
    assert_mint_reverts(4, "Kraken", 4, 'ERC721: token already minted');
}

#[test]
fn minting_an_invalid_name_reverts() {
    assert_mint_reverts(5, "", 1, 'invalid name length');
    assert_mint_reverts(5, "A name that is thirty-two bytes!", 1, 'invalid name length');
    assert_mint_reverts(5, "</script>", 1, 'invalid name char');
    assert_mint_reverts(5, "Quote\"", 1, 'invalid name char');
}

#[test]
fn minting_an_invalid_tier_reverts() {
    assert_mint_reverts(5, "Kraken", 0, 'invalid tier');
    assert_mint_reverts(5, "Kraken", 6, 'invalid tier');
}

#[test]
#[feature("safe_dispatcher")]
fn minting_to_the_zero_address_reverts() {
    let (address, _) = deploy();
    let nft = IBeastLikeNftSafeDispatcher { contract_address: address };
    match nft.mint(0.try_into().unwrap(), 5, "Kraken", 4) {
        Result::Ok(_) => panic_with_felt252('should have reverted'),
        Result::Err(panic_data) => assert(
            *panic_data.at(0) == 'ERC721: invalid receiver', 'wrong error',
        ),
    }
}
