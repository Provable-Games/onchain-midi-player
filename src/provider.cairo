//! The sound provider interface: how a composer's contract hands an NFT the MIDI and the instrument
//! definitions of a token, and how the NFT (or its renderer) asks for them.
//!
//! A Standard MIDI File can select an instrument (a program change, or a note on the percussion
//! channel) but cannot define one. So the composer's contract owns both: the score, as a raw
//! Standard MIDI File, and the instruments it plays, as a `SynthSettings`. The NFT, or the renderer
//! that builds its `token_uri`, makes one call and passes both straight to `midi_segment`:
//!
//! ```text
//! let sound = try_get_sound(provider, token_id)?;   // or ISoundProviderDispatcher
//! let segment = synth.midi_segment(sound.midi, sound.settings);
//! ```
//!
//! The class does not use this module: it is a convention between composers and NFTs, kept in this
//! crate so both sides compile against the same types. README: "Sound provider interface".
//!
//! # The provider contract
//!
//! A contract implementing `ISoundProvider` must honour all of these:
//!
//! - **Token IDs as minted.** `get_sound` takes the NFT's token ID exactly as the NFT minted it,
//!   the whole `u256`. Decode only the bits you use and ignore the rest: a provider that rejects
//!   unused bits breaks when the NFT's ID layout grows (Beasts' newer IDs are 180 bits).
//! - **A raw Standard MIDI File.** `midi` is the file's bytes (not base64, not a data URI), and it
//!   passes the page's MIDI check, `checkMidi` (`npm run check-midi`; README "MIDI contract"). The
//!   class embeds the bytes without parsing them, so a bad file does not revert: the page shows an
//!   error instead of playing.
//! - **Valid settings.** `settings` passes `crate::settings::validate`, in the class version the
//!   NFT calls; otherwise `midi_segment` reverts.
//! - **Deterministic.** The same token and the same live state always give the same bytes, for any
//!   caller. Derive the sound from the token and contract state, never from the caller or the
//!   transaction.
//! - **View-only.** No storage writes, no events, no calls that change state.
//! - **Reverts only for an unknown token.** Every token the NFT has minted gets a sound.
//!
//! Recommended:
//!
//! - **Return only what the token's MIDI uses:** the timbres of the programs and drum notes it
//!   plays, and the waves those timbres select. `SETTINGS` costs about 14.5M L2 gas per 1,000
//!   bytes through `midi_segment`: a Beast's subset is about 0.9 to 1.4 KB, a full chip bank about
//!   3.9 KB.
//! - **Hold the preset bank as constants in the provider's code,** not in storage: a storage read
//!   costs about 24K L2 gas per felt.
//! - **Keep sample tables short.** Every sample is 2 to 6 bytes of `SETTINGS`; a 32,767-step noise
//!   table adds about 2.1B L2 gas, more than many RPC nodes serve. `Waveform::WhiteNoise` needs no
//!   table.
//!
//! # Calling a provider
//!
//! `try_get_sound` calls `get_sound` with a raw `call_contract_syscall` and returns `None` instead
//! of reverting when the provider fails or replies with anything but one `TokenSound`, so an NFT
//! can fall back to its token without sound. The generated `ISoundProviderDispatcher` reverts the
//! caller on any failure, and its safe variant panics in the caller's frame on a malformed reply.

use core::num::traits::Zero;
use starknet::ContractAddress;
use starknet::syscalls::call_contract_syscall;
use crate::types::SynthSettings;

/// A token's sound: its score and the instruments the score plays, the two arguments of
/// `midi_segment`.
#[derive(Drop, Clone, Serde, PartialEq, Debug)]
pub struct TokenSound {
    /// The raw bytes of a Standard MIDI File that passes `checkMidi` (README, "MIDI contract").
    pub midi: ByteArray,
    /// The engine settings and the custom timbres and waves `midi` uses. Must pass
    /// `crate::settings::validate`.
    pub settings: SynthSettings,
}

/// Implemented by a composer's contract; called by an NFT or its renderer. See the provider
/// contract in this module's documentation and the README's "Sound provider interface".
#[starknet::interface]
pub trait ISoundProvider<T> {
    /// The sound of `token_id`, as the NFT minted it: a view, deterministic for a given token and
    /// state. Reverts only for an unknown token.
    fn get_sound(self: @T, token_id: u256) -> TokenSound;
}

/// Optional, for tools and consumers that need only the score. A provider that implements it
/// returns the same bytes as `get_sound(token_id).midi`. A provider is deployed, so unlike the
/// class it can be read with `starknet_call` from any RPC client.
#[starknet::interface]
pub trait IMidiProvider<T> {
    /// The raw Standard MIDI File of `token_id`; the same rules as `ISoundProvider::get_sound`.
    fn get_midi(self: @T, token_id: u256) -> ByteArray;
}

/// `provider.get_sound(token_id)`, or `None` when the NFT should render the token without sound:
///
/// - `provider` is zero (no call is made), the switch that turns sound off;
/// - the call fails: the provider panics (an unknown token, for example) or has no `get_sound`
///   entry point. Starknet 0.13.4 and later return these failures to the caller;
/// - the reply is not exactly one `TokenSound`: it is truncated, has trailing felts, or is
///   malformed (an integer out of its type's range, an unknown enum tag, a `ByteArray` word wider
///   than 31 bytes or a pending word wider than its length). `Serde::deserialize` checks all of
///   these, so no length or word check is needed before decoding.
///
/// Still reverts, uncatchably: a call to an undeployed address, and running out of gas.
///
/// The settings are not validated here: `midi_segment` validates them anyway, and the class
/// version the NFT calls is the authority on what is valid, which this crate's version of
/// `settings::validate` may not match. `validate` also panics rather than returning. To fall back
/// on invalid settings as well, test the provider's output against the class in CI, or call
/// `midi_segment` through `library_call_syscall` and treat an error as no sound.
pub fn try_get_sound(provider: ContractAddress, token_id: u256) -> Option<TokenSound> {
    if provider.is_zero() {
        return Option::None;
    }
    let mut calldata = array![];
    token_id.serialize(ref calldata);
    let mut reply = call_contract_syscall(provider, selector!("get_sound"), calldata.span()).ok()?;
    let sound: TokenSound = Serde::deserialize(ref reply)?;
    if !reply.is_empty() {
        return Option::None;
    }
    Option::Some(sound)
}
