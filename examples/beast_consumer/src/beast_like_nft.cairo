//! `BeastLikeNft`: a simplified Beasts-style collectible that renders its own SVG and injects the
//! onchain TinySynth player into `token_uri`.
//!
//! # Today's Beasts approach (for contrast)
//!
//! `metadata_generator.cairo` renders the SVG, base64-encodes it into the `image` data URI, builds
//! the whole JSON as one string, then base64-encodes that JSON in one more pass. That last pass
//! runs over everything, including the already-encoded image.
//!
//! # With the TinySynth class
//!
//! The JSON gains an `animation_url` holding an HTML page (engine + player + MIDI + the same SVG).
//! Encoding that page at call time would cost hundreds of millions of gas, so instead `token_uri`
//! is assembled from base64 pieces that are each encoded on their own and concatenated:
//!
//! ```text
//! "data:application/json;base64,"
//!   ++ b64('{' members ',' <pad> '"image":"data:image/svg+xml;base64,')   [1] consumer
//!   ++ b64(S)              S = svg_b64 '"' <pad>, encoded once, used twice [2] consumer
//!   ++ b64(',' <pad>)                                                     [3] consumer
//!   ++ animation_url_segment()       pre-encoded page, no runtime work    [4] library call
//!   ++ midi_segment(midi, settings)  b64(b64(D)): settings + MIDI         [5] library call
//!   ++ b64(S)                        art: closes both data URIs           [6] reuse of [2]
//!   ++ b64('}')                                                           [7] consumer
//! ```
//!
//! The rule that makes this valid: `b64(X ++ Y) == b64(X) ++ b64(Y)` when `len(X) % 3 == 0`.
//! So every piece except the last must be a multiple of 3 bytes before it is encoded; the consumer
//! pads its own pieces with spaces between JSON tokens (insignificant whitespace), and the class
//! pads `PAGE` and `D` itself. The result is ordinary standard base64 of ordinary JSON, decoded by
//! any marketplace without special handling.
//!
//! The renderer is unchanged: `render_svg` returns raw SVG exactly as before.

use core::num::traits::Zero;
use core::panic_with_felt252;
use starknet::ClassHash;

#[starknet::interface]
pub trait IBeastLikeNft<T> {
    fn token_uri(self: @T, token_id: u256) -> ByteArray;
    fn tinysynth_class_hash(self: @T) -> ClassHash;
}

/// Fixed collection description. Contains no `"` or `\`, so it embeds in JSON unescaped.
pub fn description() -> ByteArray {
    "A Beast-like example token. Its animation_url plays the onchain MIDI with the onchain TinySynth class (mocked here)."
}

/// A tiny 4x4 solid red PNG, standing in for the Beasts pixel art that the contract reads from its
/// art data contracts or a validated provider. Like Beasts' validated art URIs, it is a strict
/// base64 payload, so it can contain no `<`, quote or whitespace.
pub fn beast_image() -> ByteArray {
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR42mP4z8AARwzEcQCukw/xOF6MEQAAAABJRU5ErkJggg=="
}

/// Token table (minimal token data): name and tier. Real Beasts store a packed beast and resolve
/// names from tables or the registry.
pub fn token_data(token_id: u256) -> (ByteArray, u8) {
    if token_id == 1 {
        ("Warlock", 1)
    } else if token_id == 2 {
        ("Night's Wyvern", 2)
    } else if token_id == 3 {
        ("Fen-Troll", 3)
    } else {
        panic_with_felt252('unknown token')
    }
}

/// Beasts name charset (`beast_registry::assert_valid_name`): A-Z a-z 0-9, space, `'`, `-`.
///
/// This is an injection defense, and it is what keeps the SVG safe to place in the page's final
/// raw-text art block: the HTML parser ends that block at the first `</script`, and a name without
/// `<` or `/` cannot form one. It also keeps names JSON-safe (no `"` or `\`). `'` is allowed:
/// names go into SVG text content, never into the single-quoted attributes.
pub fn assert_valid_name(name: @ByteArray) {
    let len = name.len();
    assert(len != 0 && len <= 31, 'invalid name length');
    let mut i = 0;
    while i != len {
        let c = name[i];
        let ok = (c >= 'A' && c <= 'Z')
            || (c >= 'a' && c <= 'z')
            || (c >= '0' && c <= '9')
            || c == ' '
            || c == '\''
            || c == '-';
        assert(ok, 'invalid name char');
        i += 1;
    }
}

/// The token's raw SVG, structurally modelled on `beasts/src/beast_svg.cairo`: `<svg>` root, the
/// same SMIL opacity `<animate>` keep-alive, card styling, the name, and the pixel art embedded via
/// `foreignObject` + `xhtml:img`.
///
/// It must never contain `</script` (case-insensitive): in the `animation_url` page the SVG is the
/// contents of an unclosed `<script type="text/plain" id="art">` block that runs to the end of the
/// document. Every literal here is fixed and reviewed, the name is charset-restricted, the tier is
/// digits, and the image is a strict base64 data URI, so the SVG cannot contain `</script`.
pub fn render_svg(name: @ByteArray, tier: u8, image: @ByteArray) -> ByteArray {
    let mut svg: ByteArray =
        "<svg xmlns='http://www.w3.org/2000/svg' width='250' height='350' viewBox='0 0 250 350'>";
    svg
        .append(
            @"<animate attributeName='opacity' dur='2.2s' from='1' to='0.999' repeatCount='indefinite'/>",
        );
    svg
        .append(
            @"<style>.n{fill:#fff;font:bold 22px monospace}.t{fill:#c9c9d1;font:14px monospace}</style>",
        );
    svg.append(@"<rect width='250' height='350' rx='12' fill='#1e1e22'/>");
    svg
        .append(
            @"<rect x='4.5' y='4.5' width='241' height='341' rx='9' fill='none' stroke='#b79a5e' stroke-width='4'>",
        );
    svg
        .append(
            @"<animate attributeName='stroke-opacity' values='1;0.4;1' dur='3s' repeatCount='indefinite'/></rect>",
        );
    svg.append(@"<text x='125' y='42' text-anchor='middle' class='n'>");
    svg.append(name);
    svg.append(@"</text>");
    svg.append(@"<rect x='61' y='65' width='128' height='128' rx='8' fill='#000'/>");
    svg.append(@"<foreignObject x='61' y='65' width='128' height='128'>");
    svg.append(@"<xhtml:img xmlns:xhtml='http://www.w3.org/1999/xhtml' src='");
    svg.append(image);
    svg.append(@"' style='width:100%;height:100%;image-rendering:pixelated'/></foreignObject>");
    svg.append(@"<text x='125' y='230' text-anchor='middle' class='t'>TIER ");
    svg.append(@format!("{}", tier));
    svg.append(@"</text>");
    svg.append(@"</svg>");
    svg
}

/// JSON object members other than `image` and `animation_url`, without braces.
pub fn members(token_id: u256, name: @ByteArray, tier: u8) -> ByteArray {
    let mut m: ByteArray = "\"name\":\"";
    m.append(name);
    m.append(@"\",\"description\":\"");
    m.append(@description());
    m.append(@"\",\"attributes\":[{\"trait_type\":\"Tier\",\"value\":\"");
    m.append(@format!("{}", tier));
    m.append(@"\"},{\"trait_type\":\"Token ID\",\"value\":\"");
    m.append(@format!("{}", token_id));
    m.append(@"\"}]");
    m
}

/// Appends spaces until `(s.len() + extra) % 3 == 0`. Spaces are only ever placed between JSON
/// tokens, where they are insignificant.
fn pad3(ref s: ByteArray, extra: usize) {
    while (s.len() + extra) % 3 != 0 {
        s.append_byte(' ');
    }
}

#[starknet::contract]
pub mod BeastLikeNft {
    use onchain_tinysynth::interface::{
        IOnchainTinySynthDispatcherTrait, IOnchainTinySynthLibraryDispatcher,
    };
    use starknet::ClassHash;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use crate::sound;
    use super::{Zero, assert_valid_name, beast_image, members, pad3, render_svg, token_data};

    #[storage]
    struct Storage {
        /// Class hash of the declared (never deployed) TinySynth class. Pinning a new class hash
        /// is how the collection opts into a new engine or page version.
        tinysynth_class_hash: ClassHash,
    }

    #[constructor]
    fn constructor(ref self: ContractState, tinysynth_class_hash: ClassHash) {
        assert(tinysynth_class_hash.is_non_zero(), 'zero tinysynth class hash');
        self.tinysynth_class_hash.write(tinysynth_class_hash);
    }

    #[abi(embed_v0)]
    impl BeastLikeNftImpl of super::IBeastLikeNft<ContractState> {
        fn token_uri(self: @ContractState, token_id: u256) -> ByteArray {
            // Library calls: the class code runs in this contract's context. It has no storage,
            // so it reads and writes nothing here. No deployed TinySynth contract is involved.
            let synth = IOnchainTinySynthLibraryDispatcher {
                class_hash: self.tinysynth_class_hash.read(),
            };

            // Token data and the renderer, exactly as without sound.
            let (name, tier) = token_data(token_id);
            assert_valid_name(@name);
            let svg = render_svg(@name, tier, @beast_image());

            // [1] head = '{' members ',' <pad> '"image":"data:image/svg+xml;base64,'
            //     The pad goes after the comma (between JSON tokens) and is chosen so the whole
            //     piece is a multiple of 3 bytes. JSON key order: members, then image, then
            //     animation_url, because the animation_url string is closed by the art at [6].
            let image_key: ByteArray = "\"image\":\"data:image/svg+xml;base64,";
            let mut head: ByteArray = "{";
            head.append(@members(token_id, @name, tier));
            head.append_byte(',');
            pad3(ref head, image_key.len());
            head.append(@image_key);

            // [2] S = svg_b64 '"' <pad>. The SVG is base64-encoded exactly once (Beasts already
            //     does this for `image`); `b64(S)` is then computed once and appended twice.
            //     First use: the `image` value and its closing quote, at the JSON layer.
            //     Second use [6]: at the HTML layer, svg_b64 decodes to the raw SVG, the contents
            //     of the open art block, and '"' closes the animation_url string. The pad after
            //     '"' is JSON whitespace in both places. svg_b64 may end in '=': it ends the
            //     HTML-layer stream, where padding is legal.
            let mut s = synth.base64(svg);
            s.append_byte('"');
            pad3(ref s, 0);
            let s_b64 = synth.base64(s);

            let mut uri: ByteArray = "data:application/json;base64,";
            uri.append(@synth.base64(head)); // [1]
            uri.append(@s_b64); // [2]
            // [3] ',' + 2 spaces: exactly 3 bytes, so it is its own aligned piece.
            uri.append(@synth.base64(",  "));
            // [4] b64('"animation_url":"data:text/html;base64,' ++ b64(PAGE)). PAGE is 9-byte
            //     aligned by the class, so this is unpadded and splices at both layers. The
            //     animation_url string is left open.
            uri.append(@synth.animation_url_segment());
            // [5] b64(b64(D)), D = SETTINGS, MIDI block, then opens the art block. Also 9-byte
            //     aligned by the class. Settings are validated here; bad ones revert.
            let tier_settings = sound::settings_for(tier);
            uri.append(@synth.midi_segment(sound::midi(), tier_settings));
            // [6] The art: the same b64(S) again. Closes the art block (at EOF), the HTML data
            //     URI and the animation_url string.
            uri.append(@s_b64);
            // [7] The closing brace. Last piece, so it may be padded ('fQ==').
            uri.append(@synth.base64("}"));
            uri
        }

        fn tinysynth_class_hash(self: @ContractState) -> ClassHash {
            self.tinysynth_class_hash.read()
        }
    }
}
