//! The TinySynth sound types and interfaces, with no dependency but `starknet`: what a composer's
//! sound provider, an NFT or its renderer, and the TinySynth class compile against.
//!
//! - `types`: `TinySynthSound`, `TinySynthSettings` and the timbre, operator, wave and filter
//!   types.
//! - `interface`: `ISoundProvider` (`get_sound`) and `ITinySynth`, the class's entry points.
//! - `settings`: `validate`, the checks `midi_segment` applies, with `default_settings`,
//!   `default_operator` and the limits.
//!
//! Every public item of the three modules is also re-exported here, at the package root, so a
//! consumer writes `use tinysynth_interface::{ISoundProvider, TinySynthSound, validate};`. The
//! module paths (`tinysynth_interface::types::TinySynthSound`, ...) keep working and name the same
//! items: the items stay declared in their modules, so ABIs and class hashes still name the module
//! paths.
//!
//! The class itself, `onchain_midi_player`, depends on this package and re-exports these modules
//! at `onchain_midi_player::{types, interface}` and in `onchain_midi_player::settings`.
pub mod interface;
pub mod settings;
pub mod types;

pub use interface::{
    ISoundProvider, ISoundProviderDispatcher, ISoundProviderDispatcherTrait,
    ISoundProviderLibraryDispatcher, ISoundProviderSafeDispatcher,
    ISoundProviderSafeDispatcherTrait, ISoundProviderSafeLibraryDispatcher, ITinySynth,
    ITinySynthDispatcher, ITinySynthDispatcherTrait, ITinySynthLibraryDispatcher,
    ITinySynthSafeDispatcher, ITinySynthSafeDispatcherTrait, ITinySynthSafeLibraryDispatcher,
};
pub use settings::{
    MAX_DRUM_SLOT, MAX_OPERATORS, MAX_PROGRAM_SLOT, MAX_ROUTE, MAX_TIMBRES, MAX_WAVES,
    MIN_DRUM_SLOT, MIN_HARMONICS, MIN_SAMPLES, MIN_VOICES, default_operator, default_settings,
    validate,
};
pub use types::{
    FIXED_POINT_SCALE, Filter, FilterKind, Operator, Timbre, TinySynthSettings, TinySynthSound,
    WaveDef, Waveform,
};
