//! The TinySynth sound types and interfaces, with no dependency but `starknet`: what a composer's
//! sound provider, an NFT or its renderer, and the TinySynth class compile against.
//!
//! - `types`: `TinySynthSound`, `TinySynthSettings` and the timbre, operator, wave and filter
//!   types.
//! - `interface`: `ISoundProvider` (`get_sound`) and `ITinySynth`, the class's entry points.
//! - `settings`: `validate`, the checks `midi_segment` applies, with `default_settings`,
//!   `default_operator` and the limits.
//!
//! The class itself, `onchain_midi_player`, depends on this package and re-exports these modules
//! at `onchain_midi_player::{types, interface}` and in `onchain_midi_player::settings`.
pub mod interface;
pub mod settings;
pub mod types;
