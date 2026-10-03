//! beast_consumer: an end-to-end example of a Beasts-style NFT that injects the onchain TinySynth
//! player into its own `token_uri`.
//!
//! - `mock_tinysynth`: `MockOnchainTinySynth`, a stand-in for the real class library. It
//!   implements the declared `IOnchainTinySynth` interface with the real page constants and the
//!   real `SETTINGS`, but a byte-wise base64. Like the real class it is declared, never deployed.
//! - `beast_like_nft`: `BeastLikeNft`, the consumer. It renders its own raw SVG, holds the
//!   TinySynth class hash, and assembles `token_uri` with library calls.
//! - `sound`: the token's MIDI and `SynthSettings` (stand-ins for the onchain composer's output).

pub mod beast_like_nft;
pub mod mock_tinysynth;
pub mod sound;
