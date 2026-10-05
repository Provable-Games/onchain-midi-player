//! beast_consumer: an end-to-end example of a Beasts-style NFT that injects the onchain MIDI
//! player into its own `token_uri`.
//!
//! - `beast_like_nft`: `BeastLikeNft`, the consumer. It renders its own raw SVG, holds the class
//!   hash of the TinySynth class (`onchain_midi_player::contract::TinySynth`, declared,
//!   never deployed), and assembles `token_uri` with library calls.
//! - `sound`: the tokens' MIDI and `TinySynthSettings` (stand-ins for the onchain composer's
//! output).
//! - `beast_data` (generated): token 4's real Beast SVG and full-size synthetic score, for the
//!   full-size measurement.

pub mod beast_data;
pub mod beast_like_nft;
pub mod sound;
