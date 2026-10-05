//! The class: `TinySynth`, implementing `ITinySynth`.
//!
//! Declared, never deployed: consumers call it with `library_call` through
//! `ITinySynthLibraryDispatcher`. It has an empty storage struct and no constructor, so
//! running it in the caller's context reads and writes nothing on the caller's storage. Every entry
//! point is a view: the page constants come from the generated `page_data`, and `midi_segment` and
//! `base64` encode only their arguments.

#[starknet::contract]
pub mod TinySynth {
    use crate::interface::ITinySynth;
    use crate::types::TinySynthSettings;
    use crate::{base64, page_data, segment};

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl TinySynthImpl of ITinySynth<ContractState> {
        /// The generated constant (`page_data::animation_url_segment`). Nothing is encoded.
        fn animation_url_segment(self: @ContractState) -> ByteArray {
            page_data::animation_url_segment()
        }

        /// Validates and encodes `settings`, builds `D`, and returns `b64(b64(D))`.
        fn midi_segment(
            self: @ContractState, midi: ByteArray, settings: TinySynthSettings,
        ) -> ByteArray {
            segment::midi_segment(midi, @settings)
        }

        /// RFC 4648 base64 with `=` padding, from the crate's one encoder.
        fn base64(self: @ContractState, data: ByteArray) -> ByteArray {
            base64::bytes_base64_encode(data)
        }

        fn script_sha256(self: @ContractState) -> u256 {
            page_data::ENGINE_SHA256
        }

        fn engine(self: @ContractState) -> felt252 {
            'tinysynth'
        }

        fn version(self: @ContractState) -> felt252 {
            page_data::VERSION
        }

        fn license(self: @ContractState) -> ByteArray {
            page_data::license()
        }
    }
}
