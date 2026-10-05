//! The sound provider interface (`onchain_midi_player::interface::ISoundProvider`, with
//! `onchain_midi_player::types::TokenSound`): a mock composer's provider fed into `midi_segment`
//! end to end, the README's "Calling a provider" snippet compiled and exercised, and a Serde round
//! trip of `TokenSound`. The mocks are reached with `call_contract`, as an NFT reaches a provider.

use core::num::traits::Zero;
use onchain_midi_player::interface::{
    IOnchainMidiPlayerDispatcherTrait, ISoundProviderDispatcher, ISoundProviderDispatcherTrait,
};
use onchain_midi_player::settings::default_operator;
use onchain_midi_player::types::{
    Filter, FilterKind, Operator, SynthSettings, Timbre, TokenSound, WaveDef, Waveform,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::ContractAddress;
use starknet::syscalls::call_contract_syscall;
use crate::helpers::class;
use crate::page_fixtures::{
    case_beast_140bpm_midi, case_beast_140bpm_midi_segment, case_beast_140bpm_settings,
};
use crate::settings_fixtures::{valid_filter_extremes, valid_reference_waves};

/// A composer's provider. It decodes only the low 16 bits of the token ID, ignoring the rest as a
/// provider must, and knows one token, 1: the `beast_140bpm` golden fixture's MIDI and settings.
/// Any other value of those bits is an unknown token, the one case where it reverts. It implements
/// only `get_sound`, the whole of `ISoundProvider`.
#[starknet::contract]
mod MockSoundProvider {
    use onchain_midi_player::interface::ISoundProvider;
    use onchain_midi_player::types::TokenSound;
    use crate::page_fixtures::{case_beast_140bpm_midi, case_beast_140bpm_settings};

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl SoundProviderImpl of ISoundProvider<ContractState> {
        fn get_sound(self: @ContractState, token_id: u256) -> TokenSound {
            assert(token_id.low & 0xffff == 1, 'unknown token');
            TokenSound { midi: case_beast_140bpm_midi(), settings: case_beast_140bpm_settings() }
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
        for felt in self.felts {
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

/// A provider whose score is `token_id` words long, one felt each, with the small sound's
/// settings, to test the reply cap without storing a long reply.
#[starknet::contract]
mod MockLongScoreProvider {
    use onchain_midi_player::interface::ISoundProvider;
    use onchain_midi_player::types::TokenSound;
    use super::small_sound;

    #[storage]
    struct Storage {}

    #[abi(embed_v0)]
    impl SoundProviderImpl of ISoundProvider<ContractState> {
        fn get_sound(self: @ContractState, token_id: u256) -> TokenSound {
            let mut midi: ByteArray = "";
            for _ in 0..token_id.low {
                midi.append(@"0123456789012345678901234567890"); // 31 bytes: one felt
            }
            TokenSound { midi, settings: small_sound().settings }
        }
    }
}

// ------------------------------------------------------------------------------------------------
// The README's "Calling a provider" snippet: a copy that CI compiles and these tests run. It is not
// part of the crate. Keep it identical to the README's snippet.
// ------------------------------------------------------------------------------------------------

/// The largest reply, in felts, that this renderer will decode: set it from your own gas budget.
const MAX_REPLY_FELTS: u32 = 4_000;

/// `provider.get_sound(token_id)`, or `None` when the token should play without sound.
fn fetch_sound(provider: ContractAddress, token_id: u256) -> Option<TokenSound> {
    if provider.is_zero() {
        return Option::None; // no provider set: sound is off, and no call is made
    }
    let mut calldata = array![];
    token_id.serialize(ref calldata);
    let mut reply = call_contract_syscall(provider, selector!("get_sound"), calldata.span()).ok()?;
    if reply.len() > MAX_REPLY_FELTS {
        return Option::None; // larger than this renderer decodes
    }
    let sound: TokenSound = Serde::deserialize(ref reply)?; // `None` if truncated or malformed
    if !reply.is_empty() {
        return Option::None; // it starts like a `TokenSound` but carries more
    }
    Option::Some(sound)
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

fn mock_provider() -> ISoundProviderDispatcher {
    ISoundProviderDispatcher { contract_address: deploy("MockSoundProvider", array![]) }
}

/// A 180-bit token ID, as Beasts' newer IDs are, whose low 16 bits are 1.
fn wide_token_id() -> u256 {
    u256 { low: 0x0123_4567_89ab_cdef_0000_0000_0000_0001, high: 0x8_0000_0000_0abc }
}

// ------------------------------------------------------------------------------------------------
// The provider interface
// ------------------------------------------------------------------------------------------------

#[test]
fn provider_sound_feeds_midi_segment() {
    let provider = mock_provider();
    let sound = fetch_sound(provider.contract_address, wide_token_id()).expect('no sound');
    assert(sound.midi == case_beast_140bpm_midi(), 'midi');
    assert(sound.settings == case_beast_140bpm_settings(), 'settings');
    // Passed straight to the class, it gives the golden fixture's segment.
    let segment = class().midi_segment(sound.midi, sound.settings);
    assert(segment == case_beast_140bpm_midi_segment(), 'midi_segment != fixture');
}

#[test]
fn dispatchers_reach_the_provider() {
    let provider = mock_provider();
    let sound = provider.get_sound(1);
    assert(sound.midi == case_beast_140bpm_midi(), 'get_sound midi');
    assert(provider.get_sound(wide_token_id()) == sound, 'wide token ID');
    assert(
        fetch_sound(provider.contract_address, 1) == Option::Some(sound), 'snippet != dispatcher',
    );
}

// ------------------------------------------------------------------------------------------------
// The snippet's safe-call pattern: `None`, never a revert
// ------------------------------------------------------------------------------------------------

#[test]
fn the_snippet_gives_none_when_the_call_fails() {
    assert(fetch_sound(Zero::zero(), 1).is_none(), 'zero address');
    let provider = deploy("MockSoundProvider", array![]);
    assert(fetch_sound(provider, 2).is_none(), 'unknown token');
    assert(fetch_sound(provider, u256 { low: 0x10000, high: 1 }).is_none(), 'low bits 0');
    // The class has no `get_sound` entry point.
    assert(fetch_sound(deploy("OnchainMidiPlayer", array![]), 1).is_none(), 'no get_sound');
    // The provider still answers afterwards.
    assert(fetch_sound(provider, 1).is_some(), 'known token');
}

/// A small `TokenSound` with every kind of field, serialized: 36 felts.
pub fn small_sound() -> TokenSound {
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

// Indices into the serialized `small_sound()`: the settings' `quality` (a `u8`) and the tag of its
// first wave (a `WaveDef`, 1 for `Samples`).
const QUALITY: u32 = 4;
const WAVE_TAG: u32 = 9;

fn small_sound_felts() -> Array<felt252> {
    let mut felts = array![];
    small_sound().serialize(ref felts);
    // The indices above point where they claim.
    assert(felts.len() == 36, 'layout changed');
    assert(*felts[QUALITY] == 0 && *felts[WAVE_TAG] == 1, 'index');
    felts
}

/// `fetch_sound` on a provider that replies with the small sound's felts, felt `index` set to
/// `value`.
fn reply_with(index: u32, value: felt252) -> Option<TokenSound> {
    let mut felts = array![];
    for (i, felt) in small_sound_felts().into_iter().enumerate() {
        felts.append(if i == index {
            value
        } else {
            felt
        });
    }
    fetch_sound(deploy_raw(felts.span()), 1)
}

#[test]
fn the_snippet_rejects_a_bad_reply() {
    // A well-formed reply decodes, and so do the edges of the ranges.
    assert(
        fetch_sound(deploy_raw(small_sound_felts().span()), 1) == Option::Some(small_sound()), 'ok',
    );
    assert(reply_with(QUALITY, 255).is_some(), 'u8 255');
    // Truncated.
    let felts = small_sound_felts();
    assert(fetch_sound(deploy_raw(felts.span().slice(0, 35)), 1).is_none(), 'truncated');
    assert(fetch_sound(deploy_raw([].span()), 1).is_none(), 'empty');
    // A whole `TokenSound` followed by more felts.
    let mut trailing = small_sound_felts();
    trailing.append(0);
    assert(fetch_sound(deploy_raw(trailing.span()), 1).is_none(), 'trailing felt');
    // Out of range, and an unknown enum tag.
    assert(reply_with(QUALITY, 256).is_none(), 'u8 out of range');
    assert(reply_with(WAVE_TAG, 2).is_none(), 'unknown WaveDef tag');
}

/// Only the cap rejects a well-formed reply one felt over it: the score of token `n` is `n` words,
/// one felt each, and the rest of the reply is 35 felts.
#[test]
fn the_snippet_rejects_a_reply_over_the_cap() {
    let provider = deploy("MockLongScoreProvider", array![]);
    assert(fetch_sound(provider, (MAX_REPLY_FELTS - 35).into()).is_some(), 'at the cap');
    assert(fetch_sound(provider, (MAX_REPLY_FELTS - 34).into()).is_none(), 'over the cap');
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
        waves: waves.span(), timbres: valid_filter_extremes().timbres, ..valid_reference_waves(),
    };
    let sound = TokenSound { midi: case_beast_140bpm_midi(), settings };
    let mut felts = array![];
    sound.serialize(ref felts);
    let mut span = felts.span();
    let back: TokenSound = Serde::deserialize(ref span).expect('deserialize');
    assert(span.is_empty(), 'trailing felts');
    assert(back == sound, 'round trip');
    // The same felts through a provider.
    assert(fetch_sound(deploy_raw(felts.span()), 1) == Option::Some(sound), 'through a provider');
}
