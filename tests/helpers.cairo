//! Test helpers: the class reached by library call, and a consumer's Beasts-layout `token_uri`.

use onchain_midi_player::base64::bytes_base64_encode;
use onchain_midi_player::interface::{
    IOnchainMidiPlayerLibraryDispatcher, IOnchainMidiPlayerSafeLibraryDispatcher,
};
use onchain_midi_player::types::SynthSettings;
use onchain_midi_player::{page_data, segment};
use snforge_std::{DeclareResultTrait, declare};
use starknet::ClassHash;

/// Declares the class (never deploys it) and returns its class hash.
pub fn declare_class() -> ClassHash {
    declare("OnchainMidiPlayer").unwrap().contract_class().class_hash
}

/// The declared class, through the library dispatcher a consumer uses.
pub fn class() -> IOnchainMidiPlayerLibraryDispatcher {
    IOnchainMidiPlayerLibraryDispatcher { class_hash: declare_class() }
}

/// The declared class, through the safe library dispatcher, to read panic data.
pub fn safe_class() -> IOnchainMidiPlayerSafeLibraryDispatcher {
    IOnchainMidiPlayerSafeLibraryDispatcher { class_hash: declare_class() }
}

/// Appends spaces until `(s.len() + extra) % 3 == 0`.
fn pad3(ref s: ByteArray, extra: u32) {
    while (s.len() + extra) % 3 != 0 {
        s.append_byte(' ');
    }
}

/// The Beasts-layout `token_uri` (README, "Consumer token_uri layout"), assembled as a consumer
/// does it, with the crate's encoder and segments. The same layout as `spliceTokenUri` in
/// scripts/page.mjs, which computed the fixtures' digests.
pub fn beasts_token_uri(
    members: @ByteArray, svg: @ByteArray, midi: ByteArray, settings: @SynthSettings,
) -> ByteArray {
    let image_key: ByteArray = "\"image\":\"data:image/svg+xml;base64,";
    let mut head: ByteArray = "{";
    head.append(members);
    head.append_byte(',');
    pad3(ref head, image_key.len());
    head.append(@image_key);
    let mut s = bytes_base64_encode(svg.clone());
    s.append_byte('"');
    pad3(ref s, 0);
    let s_b64 = bytes_base64_encode(s);

    let mut uri: ByteArray = "data:application/json;base64,";
    uri.append(@bytes_base64_encode(head));
    uri.append(@s_b64);
    uri.append(@bytes_base64_encode(",  "));
    uri.append(@page_data::animation_url_segment());
    uri.append(@segment::midi_segment(midi, settings));
    uri.append(@s_b64);
    uri.append(@bytes_base64_encode("}"));
    uri
}
