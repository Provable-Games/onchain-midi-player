//! NFT-owned complete document/art/UI from standalone TinySynth segments, served as the
//! `token_uri` of a standard OpenZeppelin ERC721.
use core::num::traits::Zero;
use core::panic_with_felt252;
use starknet::{ClassHash, ContractAddress};

/// Collection name and symbol (ERC721 metadata).
pub fn collection_name() -> ByteArray {
    "Beast-like Example"
}
pub fn collection_symbol() -> ByteArray {
    "BEASTX"
}

/// The example's own entry points. `token_uri`, `name`, `symbol`, ownership, transfers and
/// approvals are the standard ERC721 ones (OpenZeppelin `ERC721MixinImpl`).
#[starknet::interface]
pub trait IBeastLikeNft<T> {
    fn tinysynth_class_hash(self: @T) -> ClassHash;
    /// Testing convenience, not a pattern for production NFTs: anyone can mint a new token
    /// `token_id` to `to` as a Beast with this name and tier. Reverts if the token exists
    /// (`ERC721: token already minted`), for a name outside the Beasts charset or longer than 31
    /// bytes, or a tier outside 1-5.
    fn mint(ref self: T, to: ContractAddress, token_id: u256, name: ByteArray, tier: u8);
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

/// The tokens the constructor mints: name and tier. Real Beasts store a packed beast and resolve
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

/// Beasts tiers: 1 (strongest) to 5.
pub fn assert_valid_tier(tier: u8) {
    assert(tier >= 1 && tier <= 5, 'invalid tier');
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
/// `foreignObject` + `xhtml:img`. The art frame's background rect, a child of the root, carries
/// `data-notes-bg`: the page's notes, when it has them, are drawn behind the art over that rect,
/// and show around the opaque 80 x 80 sprite centred in its 128 x 128.
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
    svg
        .append(
            @"<rect data-notes-bg='' x='61' y='65' width='128' height='128' rx='8' fill='#000'/>",
        );
    svg.append(@"<foreignObject x='85' y='89' width='80' height='80'>");
    svg.append(@"<xhtml:img xmlns:xhtml='http://www.w3.org/1999/xhtml' src='");
    svg.append(image);
    svg.append(@"' style='width:100%;height:100%;image-rendering:pixelated'/></foreignObject>");
    svg.append(@"<text x='125' y='230' text-anchor='middle' class='t'>TIER ");
    svg.append(@format!("{}", tier));
    svg.append(@"</text>");
    svg.append(@"</svg>");
    svg
}

/// The token's SVG: `render_svg` for the sample and minted tokens; for token 4, a real Beast's SVG
/// as the Beasts renderer produced it (22,733 bytes, `beast_data::warlock_svg`). The reference opts
/// into trusted renderer-owned inline SVG; the metadata image remains encoded. Embedded GIF clocks
/// are independent of SVG timeline suspension.
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
    use onchain_midi_player::segment_data::VERSION;
    use openzeppelin_introspection::src5::SRC5Component;
    use openzeppelin_token::erc721::{
        ERC721Component, ERC721HooksEmptyImpl, ERC721OwnerOfDefaultImpl,
    };
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ClassHash, ContractAddress};
    use crate::sound;
    use super::{
        Zero, assert_valid_name, assert_valid_tier, collection_name, collection_symbol, members,
        token_data, token_svg,
    };

    component!(path: ERC721Component, storage: erc721, event: ERC721Event);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    // ERC721, ERC721 metadata (name, symbol, token_uri) and their camelCase forms, and SRC5.
    #[abi(embed_v0)]
    impl ERC721MixinImpl = ERC721Component::ERC721MixinImpl<ContractState>;
    impl ERC721InternalImpl = ERC721Component::InternalImpl<ContractState>;
    impl ERC721OwnerImpl = ERC721OwnerOfDefaultImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        erc721: ERC721Component::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
        /// Immutable class hash of a declared TinySynth class matching this build's VERSION.
        tinysynth_class_hash: ClassHash,
        /// Each token's Beast: name and tier, validated when minted.
        beast_names: Map<u256, ByteArray>,
        beast_tiers: Map<u256, u8>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        ERC721Event: ERC721Component::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    /// Mints tokens 1-4 (`token_data`) to `recipient`.
    #[constructor]
    fn constructor(
        ref self: ContractState, tinysynth_class_hash: ClassHash, recipient: ContractAddress,
    ) {
        assert(tinysynth_class_hash.is_non_zero(), 'zero tinysynth class hash');
        // These reference consumers pin the compiled engine/API version at configuration time.
        // An older TinySynth class can share engine() while lacking the fragment ABI.
        let synth = ITinySynthLibraryDispatcher { class_hash: tinysynth_class_hash };
        assert(synth.engine() == 'tinysynth', 'not a TinySynth class');
        assert(synth.version() == VERSION, 'unsupported TinySynth version');
        self.tinysynth_class_hash.write(tinysynth_class_hash);

        // No base URI: token_uri below returns the complete document instead.
        self.erc721.initializer(collection_name(), collection_symbol(), "");
        for token_id in 1..5_u8 {
            let (name, tier) = token_data(token_id.into());
            self.mint_beast(recipient, token_id.into(), name, tier);
        }
    }

    /// The ERC721 metadata `token_uri` (and `tokenURI`): the NFT-owned document. Reverts for a
    /// token that does not exist (`ERC721: invalid token ID`).
    impl ERC721TokenURIImpl of ERC721Component::ERC721TokenURITrait<ContractState> {
        fn token_uri(
            self: @ERC721Component::ComponentState<ContractState>, token_id: u256,
        ) -> ByteArray {
            self._require_owned(token_id);
            let contract = self.get_contract();
            // Library calls: the class code runs in this contract's context. It has no storage,
            // so it reads and writes nothing here. No deployed TinySynth contract is involved.
            let synth = ITinySynthLibraryDispatcher {
                class_hash: contract.tinysynth_class_hash.read(),
            };

            // Token data and the renderer, exactly as without sound.
            let name = contract.beast_names.read(token_id);
            let tier = contract.beast_tiers.read(token_id);
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
    }

    #[abi(embed_v0)]
    impl BeastLikeNftImpl of super::IBeastLikeNft<ContractState> {
        fn tinysynth_class_hash(self: @ContractState) -> ClassHash {
            self.tinysynth_class_hash.read()
        }

        fn mint(
            ref self: ContractState, to: ContractAddress, token_id: u256, name: ByteArray, tier: u8,
        ) {
            self.mint_beast(to, token_id, name, tier);
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        /// Validates the Beast the renderer will embed (see `assert_valid_name`), stores it and
        /// mints the token.
        fn mint_beast(
            ref self: ContractState, to: ContractAddress, token_id: u256, name: ByteArray, tier: u8,
        ) {
            assert_valid_name(@name);
            assert_valid_tier(tier);
            self.erc721.mint(to, token_id);
            self.beast_names.write(token_id, name);
            self.beast_tiers.write(token_id, tier);
        }
    }
}
