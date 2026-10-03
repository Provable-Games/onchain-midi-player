//! onchain_tinysynth: a Starknet class library that serves a fully onchain,
//! offline-playable TinySynth MIDI player for NFTs.
//!
//! The class is declared but never deployed. It has no storage and no constructor, and
//! consumers call it with `library_call` while building their own `token_uri`.
//!
//! Implemented so far: the interface, the settings validation and `SETTINGS` encoding
//! (`settings`), and the generated page constants (`page_data`, built offline by
//! `scripts/build_page.mjs`). The class itself (`midi_segment`, the fast `base64`) is phase 4
//! (issue #10).

pub mod base64;
pub mod interface;
pub mod page_data;
pub mod settings;
pub mod types;
