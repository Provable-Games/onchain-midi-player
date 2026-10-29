//! `ITinySynth` and `ISoundProvider`, declared in the `tinysynth_interface` package
//! (`types/src/interface.cairo`) and re-exported here at their old paths, with their generated
//! dispatchers: `onchain_midi_player::interface::ITinySynthLibraryDispatcher` is
//! `tinysynth_interface::interface::ITinySynthLibraryDispatcher`.
pub use tinysynth_interface::interface::*;
