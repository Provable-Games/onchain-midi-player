use core::sha256::compute_sha256_byte_array;
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::{ClassHash, ContractAddress};
use stress_nft::stress_nft::IStressNftDispatcher;

pub fn owner() -> ContractAddress {
    'owner'.try_into().unwrap()
}

/// Declares the TinySynth class (never deployed) and deploys the NFT with its class hash.
pub fn setup() -> (IStressNftDispatcher, ClassHash) {
    let class_hash = declare("TinySynth").unwrap().contract_class().class_hash;
    let nft_class = declare("StressNft").unwrap().contract_class();
    let (address, _) = nft_class.deploy(@array![class_hash.into(), owner().into()]).unwrap();
    (IStressNftDispatcher { contract_address: address }, class_hash)
}

/// SHA-256 of `data` as a big-endian u256, like `sha256sum`.
pub fn sha256(data: @ByteArray) -> u256 {
    let [a, b, c, d, e, f, g, h] = compute_sha256_byte_array(data);
    let base: u128 = 0x100000000;
    let high = ((a.into() * base + b.into()) * base + c.into()) * base + d.into();
    let low = ((e.into() * base + f.into()) * base + g.into()) * base + h.into();
    u256 { high, low }
}
