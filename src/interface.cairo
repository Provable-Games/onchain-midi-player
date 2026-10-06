//! Composable TinySynth library ABI. Each segment is B64(B64(F)), where F is complete HTML
//! padded outside its elements to len(F) % 9 == 0. Consumers own the document and JSON framing.
use crate::types::{TinySynthSettings, TinySynthSound};
#[starknet::interface]
pub trait ITinySynth<T> {
    /// Standalone generic loader; window.OnchainLibraries.ready covers synchronous classic scripts.
    fn gunzip_segment(self: @T) -> ByteArray;
    /// Standalone deterministic gzip engine block, #onchain-midi-engine.
    fn engine_segment(self: @T) -> ByteArray;
    /// Standalone deterministic gzip headless API block, #onchain-midi-player.
    fn player_segment(self: @T) -> ByteArray;
    /// Validates settings and encodes verbatim MIDI into complete namespaced data blocks.
    /// MIDI contents are validated in the browser before synth creation, not onchain.
    fn midi_segment(self: @T, midi: ByteArray, settings: TinySynthSettings) -> ByteArray;
    fn engine(self: @T) -> felt252;
    fn version(self: @T) -> felt252;
    /// SHA-256 of exact decompressed pinned engine bytes, interpreted big-endian.
    fn script_sha256(self: @T) -> u256;
    /// Library/dependency notices and licenses; fixed fragments carry brief attribution.
    fn license(self: @T) -> ByteArray;
}

/// What a composer's contract implements to hand an NFT the sound of a token, and what the NFT, or
/// the renderer that builds its `token_uri`, calls. The TinySynth class does not implement it and
/// never calls it. docs/sound-provider.md has the provider contract.
///
/// A Standard MIDI File can select an instrument (a program change, or a note on the percussion
/// channel) but cannot define one. So the provider owns both the score, as a raw Standard MIDI
/// File, and the instruments it plays, as a `TinySynthSettings`.
///
/// The interface is one function, because the player needs one thing from a provider: the token's
/// sound, the MIDI and its instruments, in one call that reads the token's state once. Its reply
/// goes straight to `midi_segment`:
///
/// ```text
/// let sound = fetch_sound(provider, token_id)?; // docs/sound-provider.md, "Calling a provider"
/// let segment = synth.midi_segment(sound.midi, sound.settings);
/// ```
///
/// Interfaces for the MIDI alone or the settings alone belong to the composer's own project, not to
/// this crate. A provider adds `get_sound` beside whatever interfaces it already has: the Beast
/// composer's contract keeps its `IMidiProvider` and `ISynthSettingsProvider` and implements only
/// `get_sound` from here. That leaves the provider's own interfaces free to keep their function
/// names: Cairo raises a name clash when one contract implements two traits that share one. A tool
/// that needs only the settings calls `get_sound` and takes `.settings`: that costs latency, not
/// money, because views are free.
///
/// # Data rules
///
/// - Each engine has its own typed settings struct, here `TinySynthSettings`. There is no settings
///   enum and no opaque bytes.
/// - The felt layouts of `TinySynthSettings` and `TinySynthSound` are fixed at release.
/// - `Serde(TinySynthSound { midi, settings })` equals the calldata of `midi_segment(midi,
///   settings)`. Keep it that way.
/// - A later engine's provider function is `get_<engine>_sound`, returning `<Engine>Sound`.
///   `get_sound` belongs to the TinySynth engine permanently.
///
/// # The provider contract
///
/// A contract implementing `ISoundProvider` must honour all of these:
///
/// - **Token IDs as minted.** `get_sound` takes the NFT's token ID exactly as the NFT minted it,
///   the whole `u256`. Decode only the bits you use and ignore the rest: a provider that rejects
///   unused bits breaks when the NFT's ID layout grows (Beasts' newer IDs are 180 bits).
/// - **A raw Standard MIDI File.** `midi` is the file's bytes (not base64, not a data URI), and it
///   passes the browser MIDI check, `checkMidi` (`npm run check-midi`; docs/midi-contract.md). The
///   class embeds the bytes without parsing them, so a bad file does not revert: the headless
///   player rejects initialization.
/// - **Valid settings.** `settings` passes `crate::settings::validate`, in the class version the
///   NFT calls; otherwise `midi_segment` reverts.
/// - **Deterministic.** The same token and the same live state always give the same bytes, for any
///   caller. Derive the sound from the token and contract state, never from the caller or the
///   transaction.
/// - **View-only.** No storage writes, no events, no calls that change state.
/// - **Reverts only for an unknown token.** Every token the NFT has minted gets a sound.
///
/// Recommended:
///
/// - **Keep the other interfaces consistent.** If the provider also exposes the MIDI or the
///   settings through its own interfaces, they should equal `get_sound(id).midi` and
///   `get_sound(id).settings`, for every token, at every state. One internal function that builds
///   the `TinySynthSound` for all of them keeps that true by construction. Sharing it also matters
///   because a per-token subset of the settings depends on the programs the token's MIDI uses.
/// - **Return only what the token's MIDI uses:** the timbres of the programs and drum notes it
///   plays, and the waves those timbres select. `SETTINGS` costs about 14.5M L2 gas per 1,000
///   bytes through `midi_segment`: a Beast's subset is about 0.9 to 1.4 KB, a full chip bank about
///   3.9 KB.
/// - **Hold the preset bank as constants in the provider's code,** not in storage: a storage read
///   costs about 24K L2 gas per felt.
/// - **Keep sample tables short.** Every sample is 2 to 6 bytes of `SETTINGS`; a 32,767-step noise
///   table adds about 2.1B L2 gas, more than many RPC nodes serve. `Waveform::WhiteNoise` needs no
///   table.
#[starknet::interface]
pub trait ISoundProvider<T> {
    /// The sound of `token_id`: its score and its instruments, in one call that reads the token's
    /// state once. This is what an NFT calls. A view, deterministic for a given token and state.
    /// Reverts only for an unknown token.
    fn get_sound(self: @T, token_id: u256) -> TinySynthSound;
}
