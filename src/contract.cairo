#[starknet::contract]
pub mod TinySynth {
    use crate::interface::ITinySynth;
    use crate::types::TinySynthSettings;
    use crate::{segment, segment_data};

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl TinySynthImpl of ITinySynth<ContractState> {
        fn gunzip_segment(self: @ContractState) -> ByteArray {
            segment_data::gunzip_segment()
        }
        fn player_segment(self: @ContractState) -> ByteArray {
            segment_data::player_segment()
        }

        /// Validates and encodes `settings`, builds `D`, and returns `b64(b64(D))`.
        fn midi_segment(
            self: @ContractState, midi: ByteArray, settings: TinySynthSettings,
        ) -> ByteArray {
            segment::midi_segment(midi, @settings)
        }

        fn script_sha256(self: @ContractState) -> u256 {
            segment_data::ENGINE_SHA256
        }

        fn engine(self: @ContractState) -> felt252 {
            'tinysynth'
        }

        fn version(self: @ContractState) -> felt252 {
            segment_data::VERSION
        }

        fn license(self: @ContractState) -> ByteArray {
            segment_data::license()
        }
    }
}
