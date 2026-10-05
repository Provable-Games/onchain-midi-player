//! Invalid inputs revert. midi_segment is called through the safe library dispatcher, the same
//! library-call path BeastLikeNft uses, so the panic data can be checked exactly.

use beast_consumer::beast_like_nft::{IBeastLikeNftSafeDispatcher, IBeastLikeNftSafeDispatcherTrait};
use beast_consumer::sound;
use core::panic_with_felt252;
use onchain_tinysynth::interface::{
    IOnchainTinySynthSafeDispatcherTrait, IOnchainTinySynthSafeLibraryDispatcher,
};
use onchain_tinysynth::types::{
    Filter, FilterKind, Operator, SynthSettings, Timbre, WaveDef, Waveform,
};
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};

fn synth() -> IOnchainTinySynthSafeLibraryDispatcher {
    // Declared only, never deployed.
    let class_hash = declare("OnchainTinySynth").unwrap().contract_class().class_hash;
    IOnchainTinySynthSafeLibraryDispatcher { class_hash }
}

/// Asserts that `midi_segment` reverts with panic data starting with `expected`: the short
/// string, then the 0-based wave, timbre or (timbre, operator) indices. The library call appends
/// `'ENTRYPOINT_FAILED'` after them.
#[feature("safe_dispatcher")]
fn assert_midi_segment_reverts(settings: SynthSettings, expected: Span<felt252>) {
    match synth().midi_segment(sound::midi(), settings) {
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
    assert(synth().midi_segment(sound::midi(), sound::settings_for(1)).is_ok(), 'valid settings');
}

// Only what the format or the engine requires is checked: reverb, master volume and the upper end
// of voices take any value of their type, and the five operator fields that multiply into the
// engine's gains and frequencies take any value up to their interim engine limits.
#[test]
#[feature("safe_dispatcher")]
fn type_extremes_and_engine_limits_do_not_revert() {
    let mut s = sound::settings_for(1);
    s.reverb = 255;
    s.master_vol = 255;
    s.voices = 255;
    let mut kick = *s.timbres.at(1);
    let mut op = *kick.operators.at(0);
    op.offset_hz = -0x80000000;
    op.attack = 0xffffffff;
    op.release = 0xffffffff;
    op.volume = 1_000_000;
    op.ratio = 640_000;
    op.pitch_ratio = 160_000;
    op.sustain = 1_000_000;
    op.key_scale = -80_000;
    kick.operators = [op].span();
    s.timbres = [*s.timbres.at(0), kick].span();
    assert(synth().midi_segment(sound::midi(), s).is_ok(), 'type extremes and limits');
}

/// The kick of `settings_for(1)` with its first operator changed by `edit`.
fn with_kick_op(edit: u32) -> SynthSettings {
    let mut s = sound::settings_for(1);
    let mut kick = *s.timbres.at(1);
    let mut op = *kick.operators.at(0);
    match edit {
        0 => op.volume = 1_000_001,
        1 => op.ratio = 640_001,
        2 => op.pitch_ratio = 160_001,
        5 => op.sustain = 1_000_001,
        3 => op.key_scale = 80_001,
        _ => op.key_scale = -80_001,
    }
    kick.operators = [op].span();
    s.timbres = [*s.timbres.at(0), kick].span();
    s
}

// One past each interim engine limit reverts: the pinned engine computes non-finite values there.
#[test]
fn volume_past_engine_limit_reverts() {
    assert_midi_segment_reverts(with_kick_op(0), ['TS: volume out of range', 1, 0].span());
}

#[test]
fn ratio_past_engine_limit_reverts() {
    assert_midi_segment_reverts(with_kick_op(1), ['TS: ratio out of range', 1, 0].span());
}

#[test]
fn pitch_ratio_past_engine_limit_reverts() {
    assert_midi_segment_reverts(with_kick_op(2), ['TS: pitch_ratio out of range', 1, 0].span());
}

#[test]
fn sustain_past_engine_limit_reverts() {
    assert_midi_segment_reverts(with_kick_op(5), ['TS: sustain out of range', 1, 0].span());
}

#[test]
fn key_scale_past_engine_limit_reverts() {
    assert_midi_segment_reverts(with_kick_op(3), ['TS: key_scale out of range', 1, 0].span());
    assert_midi_segment_reverts(with_kick_op(4), ['TS: key_scale out of range', 1, 0].span());
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
    op.route = 1; // FM on itself
    kick.operators = [op].span();
    s.timbres = [*s.timbres.at(0), kick].span();
    assert_midi_segment_reverts(s, ['TS: FM target not earlier', 1, 0].span());
}

// A custom wave (issue #2) must be an entry of `waves`.
#[test]
fn custom_wave_without_table_reverts() {
    let mut s = sound::settings_for(1);
    s.timbres = one_op_timbre(false, 80, Waveform::Custom(0));
    assert_midi_segment_reverts(s, ['TS: wave index out of range', 0, 0].span());
}

#[test]
fn custom_wave_past_table_reverts() {
    let mut s = sound::settings_for(1);
    s.waves = [WaveDef::Harmonics([100_u16, 50].span())].span();
    s.timbres = one_op_timbre(false, 80, Waveform::Custom(1));
    assert_midi_segment_reverts(s, ['TS: wave index out of range', 0, 0].span());
}

#[test]
#[feature("safe_dispatcher")]
fn custom_waves_are_accepted() {
    let mut s = sound::settings_for(1);
    s
        .waves = [WaveDef::Harmonics([100_u16, 50].span()), WaveDef::Samples([127_i8, -128].span())]
        .span();
    s.timbres = one_op_timbre(false, 80, Waveform::Custom(1));
    assert(synth().midi_segment(sound::midi(), s).unwrap().len() > 0, 'midi_segment');
}

/// The kick of `settings_for(1)`, its first operator given `filter` and `route`.
fn with_kick_filter(route: u8, filter: Filter) -> SynthSettings {
    let mut s = sound::settings_for(1);
    let mut kick = *s.timbres.at(1);
    let first = *kick.operators.at(0);
    let op = Operator { route, filter: Option::Some(filter), ..first };
    kick.operators = if route == 0 {
        [op].span()
    } else {
        [first, op].span()
    };
    s.timbres = [*s.timbres.at(0), kick].span();
    s
}

// Filters (issue #3): on an audio output, with a cutoff and a Q above 0, and nothing else checked.
#[test]
#[feature("safe_dispatcher")]
fn filters_are_accepted() {
    let hat = Filter { kind: FilterKind::HighPass, cutoff: 30_000_000, key_track: false, q: 7_071 };
    assert(synth().midi_segment(sound::midi(), with_kick_filter(0, hat)).is_ok(), 'high-pass');
    let widest = Filter {
        kind: FilterKind::BandPass, cutoff: 0xffffffff, key_track: true, q: 0xffffffff,
    };
    assert(synth().midi_segment(sound::midi(), with_kick_filter(0, widest)).is_ok(), 'u32 max');
    let narrowest = Filter { kind: FilterKind::LowPass, cutoff: 1, key_track: false, q: 1 };
    assert(synth().midi_segment(sound::midi(), with_kick_filter(0, narrowest)).is_ok(), 'smallest');
}

#[test]
fn filter_on_modulator_reverts() {
    let f = Filter { kind: FilterKind::LowPass, cutoff: 10_000_000, key_track: false, q: 7_071 };
    assert_midi_segment_reverts(with_kick_filter(1, f), ['TS: filter on modulator', 1, 1].span());
    assert_midi_segment_reverts(with_kick_filter(11, f), ['TS: filter on modulator', 1, 1].span());
}

#[test]
fn filter_cutoff_or_q_of_zero_reverts() {
    let no_cutoff = Filter { kind: FilterKind::HighPass, cutoff: 0, key_track: true, q: 7_071 };
    assert_midi_segment_reverts(
        with_kick_filter(0, no_cutoff), ['TS: filter cutoff out of range', 1, 0].span(),
    );
    let no_q = Filter { kind: FilterKind::BandPass, cutoff: 10_000_000, key_track: false, q: 0 };
    assert_midi_segment_reverts(
        with_kick_filter(0, no_q), ['TS: filter q out of range', 1, 0].span(),
    );
}

#[test]
#[feature("safe_dispatcher")]
fn unknown_token_reverts() {
    let class_hash = declare("OnchainTinySynth").unwrap().contract_class().class_hash;
    let (address, _) = declare("BeastLikeNft")
        .unwrap()
        .contract_class()
        .deploy(@array![class_hash.into()])
        .unwrap();
    let nft = IBeastLikeNftSafeDispatcher { contract_address: address };
    match nft.token_uri(99) {
        Result::Ok(_) => panic_with_felt252('should have reverted'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'unknown token', 'wrong error'),
    }
}
