//! stress_nft: an NFT whose twenty tokens grow in gas, from tens of millions to over 10 billion
//! Sierra gas for the whole `token_uri` view, to find the limits of RPC providers, wallets and
//! explorers.
//!
//! - `stress_nft`: `StressNft`, a view-only consumer of the TinySynth class, modelled on
//!   `examples/beast_consumer`: the same `token_uri` assembly, library calls and alignment.
//! - `repetitions` (generated from `repetitions.json`): bars of music per token.

pub mod repetitions;
pub mod stress_nft;
