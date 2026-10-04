//! The sound provider interface (`onchain_tinysynth::provider`): a mock composer's provider fed
//! into `midi_segment` end to end, `try_get_sound`'s failure cases, and a Serde round trip of
//! `TokenSound`. The mocks are reached with `call_contract`, as an NFT reaches a provider.

use core::num::traits::Zero;
use onchain_tinysynth::interface::IOnchainTinySynthDispatcherTrait;
use onchain_tinysynth::provider::{
    IMidiProviderDispatcher, IMidiProviderDispatcherTrait, ISoundProviderDispatcher,
    ISoundProviderDispatcherTrait, TokenSound, try_get_sound,
};
use onchain_tinysynth::settings::default_operator;
use onchain_tinysynth::types::{
    Filter, FilterKind, Operator, SynthSettings, Timbre, WaveDef, Waveform,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::ContractAddress;
use crate::helpers::class;
use crate::page_fixtures::{
    case_beast_140bpm_midi, case_beast_140bpm_midi_segment, case_beast_140bpm_settings,
};
use crate::settings_fixtures::{reserved_filters, valid_reference_waves};

/// A composer's provider. It decodes only the low 16 bits of the token ID, ignoring the rest as a
/// provider must, and knows one token, 1: the `beast_140bpm` golden fixture's MIDI and settings.
/// Any other value of those bits is an unknown token, the one case where it reverts.
#[starknet::contract]
mod MockSoundProvider {
    use onchain_tinysynth::provider::{IMidiProvider, ISoundProvider, TokenSound};
    use crate::page_fixtures::{case_beast_140bpm_midi, case_beast_140bpm_settings};

    #[storage]
    struct Storage {}

    fn known(token_id: u256) {
        assert(token_id.low & 0xffff == 1, 'unknown token');
    }

    #[abi(embed_v0)]
    impl SoundProviderImpl of ISoundProvider<ContractState> {
        fn get_sound(self: @ContractState, token_id: u256) -> TokenSound {
            known(token_id);
            TokenSound { midi: case_beast_140bpm_midi(), settings: case_beast_140bpm_settings() }
        }
    }

    #[abi(embed_v0)]
    impl MidiProviderImpl of IMidiProvider<ContractState> {
        fn get_midi(self: @ContractState, token_id: u256) -> ByteArray {
            known(token_id);
            case_beast_140bpm_midi()
        }
    }
}

/// A MIDI-only provider: it has no `get_sound` entry point.
#[starknet::contract]
mod MockMidiOnlyProvider {
    use onchain_tinysynth::provider::IMidiProvider;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl MidiProviderImpl of IMidiProvider<ContractState> {
        fn get_midi(self: @ContractState, token_id: u256) -> ByteArray {
            "MThd"
        }
    }
}

/// Felts returned as they are, with no length in front.
#[derive(Drop)]
pub struct RawReply {
    pub felts: Span<felt252>,
}

impl RawReplySerde of Serde<RawReply> {
    fn serialize(self: @RawReply, ref output: Array<felt252>) {
        for felt in *self.felts {
            output.append(*felt);
        }
    }

    fn deserialize(ref serialized: Span<felt252>) -> Option<RawReply> {
        Option::None
    }
}

#[starknet::interface]
pub trait IRawSoundProvider<T> {
    fn get_sound(self: @T, token_id: u256) -> RawReply;
}

/// A provider whose `get_sound` replies with the felts given to its constructor, well-formed or
/// not.
#[starknet::contract]
mod MockRawProvider {
    use starknet::storage::{MutableVecTrait, StoragePointerReadAccess, Vec, VecTrait};
    use super::{IRawSoundProvider, RawReply};

    #[storage]
    struct Storage {
        reply: Vec<felt252>,
    }

    #[constructor]
    fn constructor(ref self: ContractState, reply: Span<felt252>) {
        for felt in reply {
            self.reply.push(*felt);
        }
    }

    #[abi(embed_v0)]
    impl RawSoundProviderImpl of IRawSoundProvider<ContractState> {
        fn get_sound(self: @ContractState, token_id: u256) -> RawReply {
            let mut felts = array![];
            for i in 0..self.reply.len() {
                felts.append(self.reply.at(i).read());
            }
            RawReply { felts: felts.span() }
        }
    }
}

fn deploy(name: ByteArray, calldata: Array<felt252>) -> ContractAddress {
    let (address, _) = declare(name).unwrap().contract_class().deploy(@calldata).unwrap();
    address
}

fn deploy_raw(reply: Span<felt252>) -> ContractAddress {
    let mut calldata = array![];
    reply.serialize(ref calldata);
    deploy("MockRawProvider", calldata)
}

/// A 180-bit token ID, as Beasts' newer IDs are, whose low 16 bits are 1.
fn wide_token_id() -> u256 {
    u256 { low: 0x0123_4567_89ab_cdef_0000_0000_0000_0001, high: 0x8_0000_0000_0abc }
}

// ------------------------------------------------------------------------------------------------
// End to end
// ------------------------------------------------------------------------------------------------

#[test]
fn provider_sound_feeds_midi_segment() {
    let provider = deploy("MockSoundProvider", array![]);
    let sound = try_get_sound(provider, wide_token_id()).expect('no sound');
    assert(sound.midi == case_beast_140bpm_midi(), 'midi');
    assert(sound.settings == case_beast_140bpm_settings(), 'settings');
    // Passed straight to the class, it gives the golden fixture's segment.
    let segment = class().midi_segment(sound.midi, sound.settings);
    assert(segment == case_beast_140bpm_midi_segment(), 'midi_segment != fixture');
}

#[test]
fn dispatchers_reach_the_provider() {
    let provider = deploy("MockSoundProvider", array![]);
    let sound = ISoundProviderDispatcher { contract_address: provider }.get_sound(1);
    assert(Option::Some(sound.clone()) == try_get_sound(provider, 1), 'dispatcher != helper');
    let midi = IMidiProviderDispatcher { contract_address: provider }.get_midi(wide_token_id());
    assert(midi == sound.midi, 'get_midi != get_sound.midi');
}

// ------------------------------------------------------------------------------------------------
// try_get_sound's failure cases: None, never a revert
// ------------------------------------------------------------------------------------------------

#[test]
fn a_panicking_provider_gives_none() {
    let provider = deploy("MockSoundProvider", array![]);
    assert(try_get_sound(provider, 2).is_none(), 'unknown token');
    assert(try_get_sound(provider, u256 { low: 0x10000, high: 1 }).is_none(), 'low bits 0');
    // The provider still answers afterwards.
    assert(try_get_sound(provider, 1).is_some(), 'known token');
}

#[test]
fn a_missing_entry_point_gives_none() {
    let provider = deploy("MockMidiOnlyProvider", array![]);
    assert(try_get_sound(provider, 1).is_none(), 'no get_sound');
}

#[test]
fn a_zero_provider_gives_none_without_a_call() {
    assert(try_get_sound(Zero::zero(), 1).is_none(), 'zero address');
}

/// A small `TokenSound` with every kind of field, serialized: 36 felts at the indices below.
fn small_sound() -> TokenSound {
    let mut midi: ByteArray = "";
    for _ in 0..40_u32 {
        midi.append_byte(0x90);
    }
    let carrier = Operator {
        wave: Waveform::Custom(0),
        filter: Option::Some(
            Filter { kind: FilterKind::BandPass, cutoff: 20_000, key_track: true, q: 7_071 },
        ),
        ..default_operator(),
    };
    let settings = SynthSettings {
        quality: 0,
        reverb: 0,
        master_vol: 40,
        voices: 8,
        waves: [WaveDef::Samples([1, -1].span())].span(),
        timbres: [Timbre { drum: false, slot: 80, operators: [carrier].span() }].span(),
    };
    TokenSound { midi, settings }
}

// Indices into the serialized `small_sound()`: the MIDI's word count, its one full word, pending
// word and pending length, then the settings.
const MIDI_WORD: u32 = 1;
const MIDI_PENDING_WORD: u32 = 2;
const MIDI_PENDING_LEN: u32 = 3;
const QUALITY: u32 = 4;
const WAVE_TAG: u32 = 9;
const SAMPLE_0: u32 = 11;
const OPERATOR_WAVE_TAG: u32 = 18;
const FILTER_OPTION_TAG: u32 = 31;
const FILTER_KIND_TAG: u32 = 32;

fn small_sound_felts() -> Array<felt252> {
    let mut felts = array![];
    small_sound().serialize(ref felts);
    // The indices above point where they claim.
    assert(felts.len() == 36, 'layout changed');
    assert(*felts[MIDI_PENDING_LEN] == 9 && *felts[QUALITY] == 0, 'MIDI or quality index');
    assert(*felts[WAVE_TAG] == 1 && *felts[SAMPLE_0] == 1, 'wave index');
    assert(*felts[OPERATOR_WAVE_TAG] == 6, 'operator wave index');
    assert(*felts[FILTER_OPTION_TAG] == 0 && *felts[FILTER_KIND_TAG] == 2, 'filter index');
    felts
}

/// `try_get_sound` on a provider that replies with `felts`, with felt `index` set to `value`.
fn reply_with(index: u32, value: felt252) -> Option<TokenSound> {
    let mut felts = array![];
    for (i, felt) in small_sound_felts().into_iter().enumerate() {
        felts.append(if i == index {
            value
        } else {
            felt
        });
    }
    try_get_sound(deploy_raw(felts.span()), 1)
}

#[test]
fn the_raw_mock_serves_a_well_formed_reply() {
    let provider = deploy_raw(small_sound_felts().span());
    assert(try_get_sound(provider, 1) == Option::Some(small_sound()), 'well-formed');
}

#[test]
fn a_truncated_reply_gives_none() {
    let felts = small_sound_felts();
    assert(try_get_sound(deploy_raw(felts.span().slice(0, 35)), 1).is_none(), 'last felt dropped');
    assert(try_get_sound(deploy_raw(felts.span().slice(0, 4)), 1).is_none(), 'MIDI only');
    assert(try_get_sound(deploy_raw([].span()), 1).is_none(), 'empty reply');
    assert(try_get_sound(deploy_raw([7].span()), 1).is_none(), 'one felt');
}

#[test]
fn a_reply_with_trailing_felts_gives_none() {
    let mut felts = small_sound_felts();
    felts.append(0);
    assert(try_get_sound(deploy_raw(felts.span()), 1).is_none(), 'trailing felt');
}

#[test]
fn a_malformed_reply_gives_none() {
    // The edges of the ranges decode.
    assert(reply_with(QUALITY, 255).is_some(), 'u8 255');
    assert(reply_with(SAMPLE_0, -128).is_some(), 'i8 -128');
    assert(
        reply_with(MIDI_PENDING_WORD, 0xff_ffff_ffff_ffff_ffff).is_some(), '9-byte pending word',
    );
    assert(reply_with(QUALITY, 256).is_none(), 'u8 out of range');
    assert(reply_with(SAMPLE_0, 128).is_none(), 'i8 out of range');
    assert(reply_with(WAVE_TAG, 2).is_none(), 'unknown WaveDef tag');
    assert(reply_with(OPERATOR_WAVE_TAG, 7).is_none(), 'unknown Waveform tag');
    assert(reply_with(FILTER_OPTION_TAG, 2).is_none(), 'unknown Option tag');
    assert(reply_with(FILTER_KIND_TAG, 3).is_none(), 'unknown FilterKind tag');
    // ByteArray: a full word of 32 bytes, a pending length of 31, a pending word wider than its
    // length (9 bytes).
    assert(
        reply_with(MIDI_WORD, 0x100000000000000000000000000000000000000000000000000000000000000)
            .is_none(),
        'word over 31 bytes',
    );
    assert(reply_with(MIDI_PENDING_LEN, 31).is_none(), 'pending length 31');
    assert(
        reply_with(MIDI_PENDING_WORD, 0x1_0000_0000_0000_0000_00).is_none(), 'wide pending word',
    );
}

// ------------------------------------------------------------------------------------------------
// Serde
// ------------------------------------------------------------------------------------------------

/// Round trip with the reference waves (sample tables of negative and positive `i8`), a harmonic
/// wave, and the fixture's filters (accepted by Serde whatever the class's checks).
#[test]
fn token_sound_serde_round_trip() {
    let mut waves = array![];
    for wave in valid_reference_waves().waves {
        waves.append(*wave);
    }
    waves.append(WaveDef::Harmonics([65_535, 0, 32_767, 0, 1].span()));
    let settings = SynthSettings {
        waves: waves.span(), timbres: reserved_filters().timbres, ..valid_reference_waves(),
    };
    let sound = TokenSound { midi: case_beast_140bpm_midi(), settings };
    let mut felts = array![];
    sound.serialize(ref felts);
    let mut span = felts.span();
    let back: TokenSound = Serde::deserialize(ref span).expect('deserialize');
    assert(span.is_empty(), 'trailing felts');
    assert(back == sound, 'round trip');
    // The same felts through a provider.
    assert(try_get_sound(deploy_raw(felts.span()), 1) == Option::Some(sound), 'through a provider');
}
