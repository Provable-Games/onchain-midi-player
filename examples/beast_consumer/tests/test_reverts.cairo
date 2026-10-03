//! Invalid inputs revert. midi_segment is called through the safe library dispatcher, the same
//! library-call path BeastLikeNft uses, so the panic data can be checked exactly.

use beast_consumer::beast_like_nft::{IBeastLikeNftSafeDispatcher, IBeastLikeNftSafeDispatcherTrait};
use beast_consumer::sound;
use core::panic_with_felt252;
use onchain_tinysynth::interface::{
    IOnchainTinySynthSafeDispatcherTrait, IOnchainTinySynthSafeLibraryDispatcher,
};
use onchain_tinysynth::types::{Operator, SynthSettings, Timbre, Waveform};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};

fn mock() -> IOnchainTinySynthSafeLibraryDispatcher {
    // Declared only, never deployed.
    let class_hash = *declare("MockOnchainTinySynth").unwrap().contract_class().class_hash;
    IOnchainTinySynthSafeLibraryDispatcher { class_hash }
}

#[feature("safe_dispatcher")]
fn assert_midi_segment_reverts(settings: SynthSettings, expected: felt252) {
    match mock().midi_segment(sound::midi(), settings) {
        Result::Ok(_) => panic_with_felt252('should have reverted'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == expected, *panic_data.at(0)),
    }
}

fn one_op_timbre(drum: bool, slot: u8, wave: Waveform) -> Span<Timbre> {
    let op = Operator {
        route: 0,
        wave,
        volume: 5_000,
        ratio: 10_000,
        offset_hz: 0,
        attack: 0,
        hold: 100,
        decay: 100,
        sustain: 0,
        release: 500,
        pitch_ratio: 10_000,
        pitch_time: 10_000,
        key_scale: 0,
        filter: Option::None,
    };
    array![Timbre { drum, slot, operators: array![op].span() }].span()
}

#[test]
#[feature("safe_dispatcher")]
fn valid_settings_do_not_revert() {
    assert(mock().midi_segment(sound::midi(), sound::settings_for(1)).is_ok(), 'valid settings');
}

#[test]
fn reverb_over_100_reverts() {
    let mut s = sound::settings_for(1);
    s.reverb = 101;
    assert_midi_segment_reverts(s, 'mock: reverb > 100');
}

#[test]
fn quality_over_1_reverts() {
    let mut s = sound::settings_for(1);
    s.quality = 2;
    assert_midi_segment_reverts(s, 'mock: quality > 1');
}

#[test]
fn zero_voices_reverts() {
    let mut s = sound::settings_for(1);
    s.voices = 0;
    assert_midi_segment_reverts(s, 'mock: voices not in 1..=64');
}

#[test]
fn drum_slot_out_of_range_reverts() {
    let mut s = sound::settings_for(1);
    s.timbres = one_op_timbre(true, 34, Waveform::Sine);
    assert_midi_segment_reverts(s, 'mock: drum slot not in 35..=81');
}

#[test]
fn harmonics_wave_reverts_in_mock() {
    let mut s = sound::settings_for(1);
    s.timbres = one_op_timbre(false, 80, Waveform::Harmonics(array![100_u16, 50].span()));
    assert_midi_segment_reverts(s, 'mock: Harmonics unsupported');
}

#[test]
#[feature("safe_dispatcher")]
fn unknown_token_reverts() {
    let mock_class_hash = *declare("MockOnchainTinySynth").unwrap().contract_class().class_hash;
    let (address, _) = declare("BeastLikeNft")
        .unwrap()
        .contract_class()
        .deploy(@array![mock_class_hash.into()])
        .unwrap();
    let nft = IBeastLikeNftSafeDispatcher { contract_address: address };
    match nft.token_uri(99) {
        Result::Ok(_) => panic_with_felt252('should have reverted'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'unknown token', 'wrong error'),
    }
}
