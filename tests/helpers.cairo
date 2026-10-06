//! Test helpers: the class reached by library call, and a consumer's Beasts-layout `token_uri`.

use core::sha256::compute_sha256_byte_array;
use onchain_midi_player::interface::{ITinySynthLibraryDispatcher, ITinySynthSafeLibraryDispatcher};
use onchain_midi_player::types::TinySynthSettings;
use snforge_std::{DeclareResultTrait, declare};
use starknet::ClassHash;
use crate::fixture_provider::{IFixtureProviderDispatcherTrait, IFixtureProviderLibraryDispatcher};

/// Declares the class (never deploys it) and returns its class hash.
pub fn declare_class() -> ClassHash {
    declare("TinySynth").unwrap().contract_class().class_hash
}

/// The declared class, through the library dispatcher a consumer uses.
pub fn class() -> ITinySynthLibraryDispatcher {
    ITinySynthLibraryDispatcher { class_hash: declare_class() }
}

/// The declared class, through the safe library dispatcher, to read panic data.
pub fn safe_class() -> ITinySynthSafeLibraryDispatcher {
    ITinySynthSafeLibraryDispatcher { class_hash: declare_class() }
}

pub fn composed_token_uri(
    members: ByteArray, svg: ByteArray, midi: ByteArray, settings: TinySynthSettings,
) -> ByteArray {
    let fixture_hash = declare("FixtureProvider").unwrap().contract_class().class_hash;
    let fixture = IFixtureProviderLibraryDispatcher { class_hash: fixture_hash };
    crate::assembly::token_uri(class(), members, svg, midi, settings, fixture.library_segment())
}
pub fn sha256(data: @ByteArray) -> u256 {
    let [a, b, c, d, e, f, g, h] = compute_sha256_byte_array(data);
    let base: u128 = 0x100000000;
    u256 {
        high: ((a.into() * base + b.into()) * base + c.into()) * base + d.into(),
        low: ((e.into() * base + f.into()) * base + g.into()) * base + h.into(),
    }
}
