//! `StressNft`: a view-only NFT for stress-testing `token_uri` infrastructure. Tokens 1 to 20 exist
//! implicitly. Each one plays the same arpeggio, repeated more times as the token id grows, so the
//! `token_uri` of token 1 costs tens of millions of Sierra gas and the last tokens cost about
//! 10 billion, around the 10B view-call budget of Pathfinder (see docs/gas.md, "Node limits").
//!
//! The `token_uri` assembly is `examples/beast_consumer`'s, unchanged (docs/token-uri-layout.md):
//! the same library calls, pieces and word alignment. What differs is the data: a small fixed SVG,
//! the default `TinySynthSettings` and a generated score of `repetitions(token_id)` bars.
//!
//! The repetition counts are calibrated offline in snforge (README.md). The owner can retune a
//! token with `set_repetitions` after live calls, without a redeploy.

use core::panic_with_felt252;
use starknet::{ClassHash, ContractAddress};

/// Tokens 1 to `TOKEN_COUNT` exist.
pub const TOKEN_COUNT: u32 = 20;

#[starknet::interface]
pub trait IStressNft<T> {
    fn token_uri(self: @T, token_id: u256) -> ByteArray;
    fn tinysynth_class_hash(self: @T) -> ClassHash;
    fn owner(self: @T) -> ContractAddress;
    /// Bars of music in a token's score.
    fn repetitions(self: @T, token_id: u256) -> u32;
    /// Owner only. Sets a token's number of bars (at least 1).
    fn set_repetitions(ref self: T, token_id: u256, repetitions: u32);
}

/// `token_id` as an index, if the token exists. Tokens 1 to `TOKEN_COUNT`.
pub fn token_index(token_id: u256) -> u32 {
    if token_id.high != 0 || token_id.low == 0 || token_id.low > TOKEN_COUNT.into() {
        panic_with_felt252('unknown token');
    }
    token_id.low.try_into().unwrap()
}

/// Fixed description. Contains no `"` or `\`, so it embeds in JSON unescaped.
pub fn description() -> ByteArray {
    "A stress-test token for the onchain MIDI player. Its score repeats one bar until the token_uri call is as expensive as its number says."
}

/// The token's name, such as `Stress #7`.
pub fn token_name(token_id: u256) -> ByteArray {
    format!("Stress #{}", token_id.low)
}

/// The token's raw SVG: a card with the name and the number of bars. Every literal is fixed and the
/// rest is digits, so it can never contain `</script` (see "Art (SVG) requirements" in
/// docs/token-uri-layout.md).
pub fn render_svg(token_id: u256, bars: u32) -> ByteArray {
    let mut svg: ByteArray =
        "<svg xmlns='http://www.w3.org/2000/svg' width='250' height='350' viewBox='0 0 250 350'>";
    svg.append(@"<rect width='250' height='350' rx='12' fill='#1e1e22'/>");
    svg
        .append(
            @"<rect x='4.5' y='4.5' width='241' height='341' rx='9' fill='none' stroke='#b79a5e' stroke-width='4'/>",
        );
    svg
        .append(
            @"<text x='125' y='160' text-anchor='middle' fill='#fff' font-family='monospace' font-size='26' font-weight='bold'>",
        );
    svg.append(@token_name(token_id));
    svg.append(@"</text>");
    svg
        .append(
            @"<text x='125' y='200' text-anchor='middle' fill='#c9c9d1' font-family='monospace' font-size='14'>",
        );
    svg.append(@format!("{} bars", bars));
    svg.append(@"</text></svg>");
    svg
}

/// JSON object members other than `image` and `animation_url`, without braces.
pub fn members(token_id: u256, bars: u32) -> ByteArray {
    let mut m: ByteArray = "\"name\":\"";
    m.append(@token_name(token_id));
    m.append(@"\",\"description\":\"");
    m.append(@description());
    m.append(@"\",\"attributes\":[{\"trait_type\":\"Token ID\",\"value\":\"");
    m.append(@format!("{}", token_id.low));
    m.append(@"\"},{\"trait_type\":\"Bars\",\"display_type\":\"number\",\"value\":");
    m.append(@format!("{}", bars));
    m.append(@"}]");
    m
}

/// Format 0, PPQ 48, 120 BPM, `bars` repetitions of one 4/4 bar, then End-of-Track on the last bar
/// line, where the player loops. 48 bytes plus 64 per bar: a Standard MIDI File that passes the
/// MIDI contract (docs/midi-contract.md).
///
/// - Tempo, time signature, program change (0, the piano) and CC7 volume at tick 0.
/// - A bar is eight eighth notes, each a note-on (velocity 96) and a note-off (velocity 0) 24 ticks
///   later: C5 E5 G5 C6 G5 E5 C5 G4. No running status, so every event is four bytes.
pub fn stress_midi(bars: u32) -> ByteArray {
    let mut bar: ByteArray = "";
    bar.append_word(0x00_904860_18_904800, 8);
    bar.append_word(0x00_904c60_18_904c00, 8);
    bar.append_word(0x00_904f60_18_904f00, 8);
    bar.append_word(0x00_905460_18_905400, 8);
    bar.append_word(0x00_904f60_18_904f00, 8);
    bar.append_word(0x00_904c60_18_904c00, 8);
    bar.append_word(0x00_904860_18_904800, 8);
    bar.append_word(0x00_904360_18_904300, 8);

    let mut track: ByteArray = "";
    track.append_word(0x00_ff5103_07a120, 7); // t=0 tempo 500000 us per quarter (120 BPM)
    track.append_word(0x00_ff5804_04021808, 8); // t=0 time signature 4/4
    track.append_word(0x00_c000, 3); // t=0 ch1 program 0
    track.append_word(0x00_b00764, 4); // t=0 ch1 CC7 volume 100
    let mut i = 0;
    while i != bars {
        track.append(@bar);
        i += 1;
    }
    track.append_word(0x00_ff2f00, 4); // End-of-Track, 4 bytes after the last note-off

    let mut midi: ByteArray = "";
    midi.append_word(0x4d546864_00000006, 8); // MThd, header length 6
    midi.append_word(0x0000_0001_0030, 6); // format 0, 1 track, PPQ 48
    midi.append_word(0x4d54726b, 4); // MTrk
    midi.append_word(track.len().into(), 4); // track length
    midi.append(@track);
    midi
}

#[starknet::contract]
pub mod StressNft {
    use core::num::traits::Zero;
    use onchain_midi_player::interface::{ITinySynthDispatcherTrait, ITinySynthLibraryDispatcher};
    use onchain_midi_player::settings::default_settings;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ClassHash, ContractAddress, get_caller_address};
    use crate::repetitions::default_repetitions;
    use super::{TOKEN_COUNT, members, render_svg, stress_midi, token_index};

    #[storage]
    struct Storage {
        /// Class hash of the declared (never deployed) TinySynth class.
        tinysynth_class_hash: ClassHash,
        owner: ContractAddress,
        /// Bars of music per token, from `repetitions::default_repetitions` until the owner
        /// changes one.
        repetitions: Map<u32, u32>,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState, tinysynth_class_hash: ClassHash, owner: ContractAddress,
    ) {
        assert(tinysynth_class_hash.is_non_zero(), 'zero tinysynth class hash');
        assert(owner.is_non_zero(), 'zero owner');
        // Engine classes share the midi_segment selector: reject another engine's class here,
        // rather than render the wrong page later.
        let synth = ITinySynthLibraryDispatcher { class_hash: tinysynth_class_hash };
        assert(synth.engine() == 'tinysynth', 'not a TinySynth class');
        self.tinysynth_class_hash.write(tinysynth_class_hash);
        self.owner.write(owner);
        let mut token = 1;
        while token <= TOKEN_COUNT {
            self.repetitions.write(token, default_repetitions(token));
            token += 1;
        }
    }

    #[abi(embed_v0)]
    impl StressNftImpl of super::IStressNft<ContractState> {
        fn token_uri(self: @ContractState, token_id: u256) -> ByteArray {
            let synth = ITinySynthLibraryDispatcher {
                class_hash: self.tinysynth_class_hash.read(),
            };
            let bars = self.repetitions.read(token_index(token_id));
            let svg = render_svg(token_id, bars);

            crate::assembly::token_uri(
                synth, members(token_id, bars), svg, stress_midi(bars), default_settings(), "",
            )
        }

        fn tinysynth_class_hash(self: @ContractState) -> ClassHash {
            self.tinysynth_class_hash.read()
        }

        fn owner(self: @ContractState) -> ContractAddress {
            self.owner.read()
        }

        fn repetitions(self: @ContractState, token_id: u256) -> u32 {
            self.repetitions.read(token_index(token_id))
        }

        fn set_repetitions(ref self: ContractState, token_id: u256, repetitions: u32) {
            assert(get_caller_address() == self.owner.read(), 'caller is not the owner');
            assert(repetitions != 0, 'zero repetitions');
            self.repetitions.write(token_index(token_id), repetitions);
        }
    }
}
