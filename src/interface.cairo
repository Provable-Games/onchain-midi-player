//! Public interface of the onchain MIDI player class library.
//!
//! This class is meant to be **declared, never deployed**. It has no storage and no
//! constructor. Consumers call it with `library_call` through the dispatcher that the
//! `#[starknet::interface]` attribute generates:
//!
//! ```text
//! let synth = IOnchainMidiPlayerLibraryDispatcher { class_hash: MIDI_PLAYER_CLASS_HASH };
//! let segment = synth.animation_url_segment();
//! ```
//!
//! # Notation used in the doc comments below
//!
//! - `b64(X)`: standard RFC 4648 base64 of the bytes `X` (alphabet `A-Z a-z 0-9 + /`,
//!   `=` padding, no line breaks).
//! - `X ++ Y` or `X Y`: byte concatenation.
//! - `<pad>`: zero or more ASCII spaces (0x20) inserted only to reach a length
//!   alignment. Spaces are placed where they are insignificant: between JSON tokens, or
//!   around base64 text that the player trims.
//! - `PAGE`: the fixed HTML page of this class version (the TinySynth engine, gzipped in a
//!   `<script type="text/javascript+gzip" src="data:text/javascript;base64,...">` tag, the
//!   gunzip shim that inflates it in the browser, the player, and the opening of the
//!   settings text block). It ends with the opening tag
//!   `<script type="text/plain" id="settings">`, followed by any alignment `<pad>` (which
//!   then falls inside the settings block and is ignored by the player). The gzip payload is
//!   base64 text, which contains no `<`, `"` or `&`, so it can close neither its tag nor
//!   its attribute.
//! - `SETTINGS`: the ASCII encoding of a `SynthSettings` value (see `types.cairo`), format
//!   version 1, as specified in `settings.cairo` (issue #1): comma-separated canonical
//!   decimal integers, with no length cap: its cost grows with it (see the README). It
//!   contains only digits, `-` and `,`, so it can never close its block. Example (default
//!   settings): `1,1,30,40,64,0,0`.
//! - `D`: the per-token HTML fragment
//!   `SETTINGS '</script><script type="text/plain" id="midi">' b64(midi) <pad>
//!   '</script><script type="text/plain" id="art">'`.
//!
//! # Splicing rule
//!
//! `b64(X ++ Y) == b64(X) ++ b64(Y)` whenever `len(X) % 3 == 0`. This class relies on it
//! to store the fixed page already encoded (at both base64 layers) and to encode only
//! per-token data at call time.
//!
//! In the nested layout the pre-encoded pieces sit at both layers, so their alignment
//! requirement compounds: a piece `X` that is base64-encoded twice and spliced at both
//! layers needs `len(X) % 3 == 0` (inner layer) **and** `len(b64(X)) % 3 == 0` (outer
//! layer). Since `len(b64(X)) == 4 * len(X) / 3` for aligned `X`, that is
//! `len(X) % 9 == 0`. Both `PAGE` and `D` are therefore 9-byte aligned by this class.
//!
//! # Consumer `token_uri` layout
//!
//! ```text
//! "data:application/json;base64,"
//!   ++ b64('{' members ',' <pad> '"image":"data:image/svg+xml;base64,')
//!   ++ b64(S)                       S = svg_b64 '"' <pad>   (encoded once, used twice)
//!   ++ b64(',' <pad>)
//!   ++ animation_url_segment()      pre-encoded engine + page, never encoded at call time
//!   ++ midi_segment(midi, settings) per-token: settings and MIDI blocks, then opens art
//!   ++ b64(S)                       art closes both data URIs
//!   ++ b64('}')
//! ```
//!
//! Every piece except the last must have a JSON-layer length that is a multiple of 3
//! before it is encoded; the consumer pads its own pieces with spaces between JSON tokens
//! to achieve this. The pieces returned by this class already satisfy it.
//!
//! Decoded, the `animation_url` value is the HTML-layer base64 stream
//! `b64(PAGE) ++ b64(D) ++ svg_b64`, which decodes to `PAGE ++ D ++ SVG`. The SVG is the
//! last thing in the document, as the raw contents of the unclosed
//! `<script type="text/plain" id="art">` element (a raw-text element, so the SVG markup
//! is inert). Because `svg_b64` is the end of that stream, trailing `=` padding in it is
//! legal. `b64(PAGE)` and `b64(D)` are mid-stream and are always unpadded.
//!
//! The HTML parser ends the art element at the first `</script`, so the SVG must never contain
//! `</script` in any letter case. The class never sees the SVG: the consumer checks this in its
//! own tests (see "Art (SVG) requirements" in the README).
//!
//! This file also declares `ISoundProvider`, at the end: the interface a composer's contract
//! implements to hand an NFT a token's MIDI and `SynthSettings`. The class does not implement it.

use crate::types::{SynthSettings, TokenSound};

/// Onchain MIDI player class library.
///
/// All functions are view-only and deterministic: for a given class hash, the same inputs
/// always give the same output. The engine and the page are fixed per class version; a
/// new engine or page means a new class hash and a new `version()`. Sound settings and
/// custom sounds are supplied by the consumer on each call through `SynthSettings`.
///
/// Intended to be invoked with `library_call` via `IOnchainMidiPlayerLibraryDispatcher`.
/// The class holds no state, so executing it in the caller's context reads and writes
/// nothing on the caller's storage.
#[starknet::interface]
pub trait IOnchainMidiPlayer<T> {
    // ------------------------------------------------------------------------------------
    // For contracts that build their own token_uri JSON (the consumer layout).
    // ------------------------------------------------------------------------------------

    /// Returns the fixed `animation_url` member of the token JSON, already encoded at the
    /// JSON layer.
    ///
    /// Output (bytes, ASCII base64 text):
    ///
    /// ```text
    /// b64('"animation_url":"data:text/html;base64,' ++ b64(PAGE))
    /// ```
    ///
    /// - The JSON prefix `"animation_url":"data:text/html;base64,` is 39 bytes
    ///   (`39 % 3 == 0`).
    /// - `len(PAGE) % 9 == 0`, so `b64(PAGE)` is unpadded, `4 * len(PAGE) / 3` bytes long
    ///   and a multiple of 3; the whole inner string is a multiple of 3 and its encoding is
    ///   unpadded. The result can therefore be spliced between other JSON-layer base64
    ///   pieces.
    /// - The `animation_url` string is left open: it is continued by `midi_segment()` and
    ///   closed by the consumer's `b64(S)`.
    ///
    /// Cost: a constant, stored in the class at build time (a string literal). Nothing is
    /// base64-encoded at call time. Materializing it costs about 0.35M L2 gas; through a library
    /// call about 7.8M, most of it returning the 53,476-byte result.
    fn animation_url_segment(self: @T) -> ByteArray;

    /// Returns the per-token settings and MIDI piece, encoded at both layers, to follow
    /// `animation_url_segment()`.
    ///
    /// Inputs:
    /// - `midi`: a Standard MIDI File (see "MIDI contract" in the README). The bytes
    ///   are embedded verbatim (as base64 text); this function does not parse or validate
    ///   them.
    /// - `settings`: engine settings and optional custom sounds (see `types.cairo`).
    ///   `settings::validate` checks what the format and the engine require; a failed check
    ///   reverts with a `'TS: ...'` short string followed by the 0-based indices of the
    ///   offending wave, timbre or operator, so an invalid setting can never reach the page.
    ///   The checks, their order and their messages are listed in `settings.cairo`. They are
    ///   enforced only here: the page parses `SETTINGS` strictly and trusts them.
    ///
    /// Output (bytes, ASCII base64 text):
    ///
    /// ```text
    /// b64(b64(D))
    /// D = SETTINGS '</script><script type="text/plain" id="midi">' b64(midi) <pad>
    ///     '</script><script type="text/plain" id="art">'
    /// ```
    ///
    /// - `<pad>` is 0..=8 spaces chosen so that `len(D) % 9 == 0`. The spaces fall inside
    ///   the MIDI text block, where the player trims them.
    /// - `b64(midi)` may end with `=` padding; it is plain text inside `D`, not part of the
    ///   spliced stream.
    /// - With `len(D) % 9 == 0`, `b64(D)` is unpadded and a multiple of 3 long, and
    ///   `b64(b64(D))` is unpadded, so the result splices at both layers.
    /// - `D` closes the MIDI block and opens the art block; the consumer's following
    ///   `b64(S)` supplies the art and closes both data URIs.
    ///
    /// Cost: validation and encoding of `settings`, then base64 over `midi` once and over `D`
    /// (about `len(SETTINGS) + 4 * len(midi) / 3 + 89` bytes) twice; independent of engine size.
    /// `SETTINGS` is 16 bytes with defaults, plus about 6 bytes per timbre and 50 per operator
    /// (the 3 Beast reference sounds: 334 bytes). Validating and encoding 6 timbres costs about
    /// 3.2M L2 gas, and the largest valid `SETTINGS` in v1 without custom waves (175 timbres of 8
    /// filtered operators, every field at its type's extreme, 218,264 bytes) about 1.32B. Base64 is
    /// the rest. Through a library call, the whole call costs about 61M for a score the size of the
    /// largest Beast score (3,716 bytes) with the reference sounds, about 14M more per 1,000 bytes
    /// of `SETTINGS`, and about 3.2B with that largest `SETTINGS` (measurements in the README).
    /// There is no byte cap: the gas limit of the call decides.
    fn midi_segment(self: @T, midi: ByteArray, settings: SynthSettings) -> ByteArray;

    // ------------------------------------------------------------------------------------
    // Helpers and verification.
    // ------------------------------------------------------------------------------------

    /// Standard RFC 4648 base64 (alphabet `A-Z a-z 0-9 + /`) with `=` padding and no line
    /// breaks. Empty input returns an empty `ByteArray`.
    ///
    /// Exposed so consumers can encode their own JSON pieces with the same encoder this
    /// class uses (`crate::base64::bytes_base64_encode`, which also serves `midi_segment`).
    /// The result is a `ByteArray` so callers can splice it directly; output length is
    /// `4 * ceil(len(data) / 3)`.
    ///
    /// The encoder is the maintainer's optimized word-wise encoder, `bytes_base64_encode` of the
    /// `game_components_encoding` package, which `crate::base64` re-exports.
    ///
    /// Cost: linear in `len(data)`; about 3.6K L2 gas per input byte for large inputs, through a
    /// library call. Do not use it on large fixed data; that is why the engine and page are stored
    /// pre-encoded.
    fn base64(self: @T, data: ByteArray) -> ByteArray;

    /// SHA-256 of the embedded TinySynth engine JavaScript, decompressed: exactly the bytes of
    /// the pinned fork build's minified file, which `PAGE` carries gzipped and the page
    /// inflates. Stored as a constant. The 32-byte digest is interpreted big-endian (first
    /// digest byte is the most significant byte of the `u256`), matching the usual hex form
    /// printed by `sha256sum`.
    ///
    /// The raw script is deliberately not exposed: the class is never deployed, so only
    /// contracts could call such a getter, and the script is already inside every
    /// `animation_url`. To verify, decode a `token_uri` offchain, take the `src` of the page's
    /// `text/javascript+gzip` tag, base64-decode it after the `data:text/javascript;base64,`
    /// prefix (its SHA-256 is `page_data::GZIP_SHA256`), gunzip it, hash the result, and
    /// compare with this value and with `sha256sum` of the fork's `webaudio-tinysynth.min.js`
    /// at the pinned commit or release (see the README).
    fn script_sha256(self: @T) -> u256;

    /// Short-string (at most 31 ASCII bytes) identifying the engine and page versions of
    /// this class: `'tinysynth-<engine ref>+page.<n>'`, e.g. `'tinysynth-b70ba90+page.1'`, where
    /// the engine ref is the pinned fork commit (short SHA) or release tag. Changes whenever the
    /// engine, page, or
    /// built-in sound settings change, which always implies a new class hash.
    fn version(self: @T) -> felt252;

    /// Returns the license notice for this class: Apache License 2.0, covering both this
    /// library and the embedded TinySynth engine (upstream copyright notice plus the
    /// notice describing the modifications made in the Provable-Games fork), then the MIT
    /// License of fflate, from which the page's gunzip shim is derived, and the MIT License of
    /// game-components, whose base64 encoder (`game_components_encoding`) the class embeds.
    fn license(self: @T) -> ByteArray;
}

// ----------------------------------------------------------------------------------------------
// Interfaces implemented by other contracts (sound providers). The player class does NOT
// implement the interface below: it is a convention between composers and NFTs, declared here so
// that both compile against the same `ISoundProvider` and `TokenSound`.
// ----------------------------------------------------------------------------------------------

/// What a composer's contract implements to hand an NFT the sound of a token, and what the NFT, or
/// the renderer that builds its `token_uri`, calls. The player class does not implement it and
/// never calls it. README: "Sound provider interface", which has the provider contract.
///
/// A Standard MIDI File can select an instrument (a program change, or a note on the percussion
/// channel) but cannot define one. So the provider owns both the score, as a raw Standard MIDI
/// File, and the instruments it plays, as a `SynthSettings`.
///
/// The interface is one function, because the player needs one thing from a provider: the token's
/// sound, the MIDI and its instruments, in one call that reads the token's state once. Its reply
/// goes straight to `midi_segment`:
///
/// ```text
/// let sound = <the README's snippet>(provider, token_id)?;
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
/// # The provider contract
///
/// A contract implementing `ISoundProvider` must honour all of these:
///
/// - **Token IDs as minted.** `get_sound` takes the NFT's token ID exactly as the NFT minted it,
///   the whole `u256`. Decode only the bits you use and ignore the rest: a provider that rejects
///   unused bits breaks when the NFT's ID layout grows (Beasts' newer IDs are 180 bits).
/// - **A raw Standard MIDI File.** `midi` is the file's bytes (not base64, not a data URI), and it
///   passes the page's MIDI check, `checkMidi` (`npm run check-midi`; README "MIDI contract"). The
///   class embeds the bytes without parsing them, so a bad file does not revert: the page shows an
///   error instead of playing.
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
///   the `TokenSound` for all of them keeps that true by construction. Sharing it also matters
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
    fn get_sound(self: @T, token_id: u256) -> TokenSound;
}
