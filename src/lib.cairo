//! onchain_midi_player: a Starknet class library that serves a fully onchain,
//! offline-playable TinySynth MIDI player for NFTs.
//!
//! The class (`contract::OnchainTinySynth`) is declared but never deployed. It has no storage and
//! no constructor, and consumers call it with `library_call` while building their own `token_uri`.
//!
//! - `interface`: `IOnchainTinySynth`, the public interface, with the exact byte formats, and
//!   `ISoundProvider`, the interface a composer's contract implements to hand an NFT a token's MIDI
//!   and `TinySynthSettings`. The class does not implement or call `ISoundProvider`.
//! - `contract`: the class.
//! - `segment`: `D` and `midi_segment`.
//! - `settings`: validation and the `SETTINGS` encoding of `types::TinySynthSettings`.
//! - `page_data`: the generated page constants, built offline by `scripts/build_page.mjs`.
//! - `base64`: the crate's one base64 encoder, re-exported from the `game_components_encoding`
//!   package (see its header).

pub mod base64;
pub mod contract;
pub mod interface;
pub mod page_data;
pub mod segment;
pub mod settings;
pub mod types;
