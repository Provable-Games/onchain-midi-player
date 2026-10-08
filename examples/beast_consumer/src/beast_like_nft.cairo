//! NFT-owned complete document/art/UI from standalone TinySynth segments.
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
    "A Beast-like example token. Its animation_url plays the onchain MIDI with the TinySynth class."
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
    } else if token_id == 4 {
        ("Shiny Warlock", 1)
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
/// Original SVG bytes are preserved inside encoded image data URIs. Supplied script-like text
/// cannot terminate any parent script/data block; bootstrap and closing HTML follow the image.
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

/// The token's SVG: `render_svg` for the sample tokens; for token 4, a real Beast's SVG as the
/// Beasts renderer produced it (22,733 bytes, `beast_data::warlock_svg`, isolated as an encoded
/// image).
pub fn token_svg(token_id: u256, name: @ByteArray, tier: u8) -> ByteArray {
    if token_id == 4 {
        crate::beast_data::warlock_svg()
    } else {
        render_svg(name, tier, @beast_image())
    }
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

#[starknet::contract]
pub mod BeastLikeNft {
    use onchain_midi_player::interface::{ITinySynthDispatcherTrait, ITinySynthLibraryDispatcher};
    use starknet::ClassHash;
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use crate::sound;
    use super::{Zero, assert_valid_name, members, token_data, token_svg};

    #[storage]
    struct Storage {
        /// Class hash of the declared (never deployed) TinySynth class. Pinning a new class hash
        /// is how the collection opts into a new engine or page version.
        tinysynth_class_hash: ClassHash,
    }

    #[constructor]
    fn constructor(ref self: ContractState, tinysynth_class_hash: ClassHash) {
        assert(tinysynth_class_hash.is_non_zero(), 'zero tinysynth class hash');
        // Engine classes share the midi_segment selector: reject another engine's class here,
        // rather than render the wrong page later.
        let synth = ITinySynthLibraryDispatcher { class_hash: tinysynth_class_hash };
        assert(synth.engine() == 'tinysynth', 'not a TinySynth class');
        self.tinysynth_class_hash.write(tinysynth_class_hash);
    }

    #[abi(embed_v0)]
    impl BeastLikeNftImpl of super::IBeastLikeNft<ContractState> {
        fn token_uri(self: @ContractState, token_id: u256) -> ByteArray {
            // Library calls: the class code runs in this contract's context. It has no storage,
            // so it reads and writes nothing here. No deployed TinySynth contract is involved.
            let synth = ITinySynthLibraryDispatcher {
                class_hash: self.tinysynth_class_hash.read(),
            };

            // Token data and the renderer, exactly as without sound.
            let (name, tier) = token_data(token_id);
            assert_valid_name(@name);
            let svg = token_svg(token_id, @name, tier);

            crate::assembly::token_uri(
                synth,
                members(token_id, @name, tier),
                svg,
                sound::token_midi(token_id),
                sound::token_settings(token_id, tier),
                "",
                true // Only this contract's trusted renderer is eligible for inline SVG.
            )
        }

        fn tinysynth_class_hash(self: @ContractState) -> ClassHash {
            self.tinysynth_class_hash.read()
        }
    }
}
