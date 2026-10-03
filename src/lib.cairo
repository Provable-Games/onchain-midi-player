//! onchain_tinysynth: a Starknet class library that serves a fully onchain,
//! offline-playable TinySynth MIDI player for NFTs.
//!
//! The class is declared but never deployed. It has no storage and no constructor, and
//! consumers call it with `library_call` while building their own `token_uri`.
//!
//! Scaffold only: the interface is declared; the implementation is pending design
//! approval.

pub mod base64;
pub mod interface;
pub mod page_data;
pub mod settings;
pub mod types;
