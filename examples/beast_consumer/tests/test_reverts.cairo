//! Invalid inputs revert. midi_segment is called through the safe library dispatcher, the same
//! library-call path BeastLikeNft uses, so the panic data can be checked exactly.

use beast_consumer::beast_like_nft::{IBeastLikeNftSafeDispatcher, IBeastLikeNftSafeDispatcherTrait};
use beast_consumer::sound;
use core::panic_with_felt252;
use onchain_tinysynth::interface::{
    IOnchainTinySynthSafeDispatcherTrait, IOnchainTinySynthSafeLibraryDispatcher,
};
use onchain_tinysynth::types::{Operator, SynthSettings, Timbre, WaveDef, Waveform};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};

fn mock() -> IOnchainTinySynthSafeLibraryDispatcher {
    // Declared only, never deployed.
    let class_hash = *declare("MockOnchainTinySynth").unwrap().contract_class().class_hash;
    IOnchainTinySynthSafeLibraryDispatcher { class_hash }
}

/// Asserts that `midi_segment` reverts with panic data starting with `expected`: the short
/// string, then the 0-based wave, timbre or (timbre, operator) indices. The library call appends
/// `'ENTRYPOINT_FAILED'` after them.
#[feature("safe_dispatcher")]
fn assert_midi_segment_reverts(settings: SynthSettings, expected: Span<felt252>) {
    match mock().midi_segment(sound::midi(), settings) {
        Result::Ok(_) => panic_with_felt252('should have reverted'),
        Result::Err(panic_data) => {
            assert(panic_data.len() >= expected.len(), 'panic data too short');
            for i in 0..expected.len() {
                assert(*panic_data.at(i) == *expected.at(i), *panic_data.at(i));
            }
        },
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
    assert_midi_segment_reverts(s, ['TS: reverb out of range'].span());
}

#[test]
fn quality_over_1_reverts() {
    let mut s = sound::settings_for(1);
    s.quality = 2;
    assert_midi_segment_reverts(s, ['TS: quality out of range'].span());
}

#[test]
fn zero_voices_reverts() {
    let mut s = sound::settings_for(1);
    s.voices = 0;
    assert_midi_segment_reverts(s, ['TS: voices out of range'].span());
}

#[test]
fn drum_slot_out_of_range_reverts() {
    let mut s = sound::settings_for(1);
    s.timbres = one_op_timbre(true, 34, Waveform::Sine);
    assert_midi_segment_reverts(s, ['TS: drum slot out of range', 0].span());
}

#[test]
fn operator_error_reports_timbre_and_operator() {
    let mut s = sound::settings_for(1);
    let mut kick = *s.timbres.at(1);
    let mut op = *kick.operators.at(0);
    op.volume = 1_000_001;
    kick.operators = [op].span();
    s.timbres = [*s.timbres.at(0), kick].span();
    assert_midi_segment_reverts(s, ['TS: volume out of range', 1, 0].span());
}

// Custom waves are rejected until issue #2 lands.
#[test]
fn custom_wave_reverts_until_issue_2() {
    let mut s = sound::settings_for(1);
    s.timbres = one_op_timbre(false, 80, Waveform::Custom(0));
    assert_midi_segment_reverts(s, ['TS: custom wave unsupported', 0, 0].span());
}

#[test]
fn custom_wave_table_reverts_until_issue_2() {
    let mut s = sound::settings_for(1);
    s.waves = [WaveDef::Harmonics([100_u16, 50].span())].span();
    assert_midi_segment_reverts(s, ['TS: custom wave unsupported'].span());
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
