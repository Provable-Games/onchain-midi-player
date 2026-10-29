//! The root re-exports of `tinysynth_interface`: every item imported from the package root, and
//! each one the same item as at its module path (a value of one type is a value of the other, and
//! the root dispatchers call the class).

use tinysynth_interface::{
    FIXED_POINT_SCALE, Filter, FilterKind, ISoundProvider, ISoundProviderDispatcher,
    ISoundProviderDispatcherTrait, ISoundProviderLibraryDispatcher, ISoundProviderSafeDispatcher,
    ISoundProviderSafeDispatcherTrait, ISoundProviderSafeLibraryDispatcher, ITinySynth,
    ITinySynthDispatcher, ITinySynthDispatcherTrait, ITinySynthLibraryDispatcher,
    ITinySynthSafeDispatcher, ITinySynthSafeDispatcherTrait, ITinySynthSafeLibraryDispatcher,
    MAX_DRUM_SLOT, MAX_OPERATORS, MAX_PROGRAM_SLOT, MAX_ROUTE, MAX_TIMBRES, MAX_WAVES,
    MIN_DRUM_SLOT, MIN_HARMONICS, MIN_SAMPLES, MIN_VOICES, Operator, Timbre, TinySynthSettings,
    TinySynthSound, WaveDef, Waveform, default_operator, default_settings, validate,
};
use crate::helpers::class;

#[test]
fn root_items_are_the_module_items() {
    // Types: a root value is a module value, and the other way round.
    let settings: tinysynth_interface::types::TinySynthSettings = default_settings();
    let settings: TinySynthSettings = settings;
    validate(@settings);
    tinysynth_interface::settings::validate(@settings);
    let operator: Operator = tinysynth_interface::settings::default_operator();
    let operator: tinysynth_interface::types::Operator = operator;
    assert_eq!(operator, default_operator());
    let filter = Filter { kind: FilterKind::LowPass, cutoff: 1000, key_track: false, q: 10000 };
    let timbre = Timbre {
        drum: false,
        slot: 0,
        operators: array![Operator { filter: Some(filter), ..operator }].span(),
    };
    let wave: WaveDef = tinysynth_interface::types::WaveDef::Harmonics(array![1].span());
    let _: Waveform = tinysynth_interface::types::Waveform::Sine;
    let sound: tinysynth_interface::types::TinySynthSound = TinySynthSound {
        midi: "",
        settings: TinySynthSettings {
            timbres: array![timbre].span(), waves: array![wave].span(), ..settings,
        },
    };
    let _: TinySynthSound = sound;

    // Constants: the same values.
    assert_eq!(FIXED_POINT_SCALE, tinysynth_interface::types::FIXED_POINT_SCALE);
    assert_eq!(
        array![
            MAX_WAVES, MAX_TIMBRES, MAX_OPERATORS, MIN_HARMONICS, MIN_SAMPLES, MAX_ROUTE,
            MIN_DRUM_SLOT, MAX_DRUM_SLOT, MAX_PROGRAM_SLOT, MIN_VOICES,
        ],
        array![
            tinysynth_interface::settings::MAX_WAVES, tinysynth_interface::settings::MAX_TIMBRES,
            tinysynth_interface::settings::MAX_OPERATORS,
            tinysynth_interface::settings::MIN_HARMONICS,
            tinysynth_interface::settings::MIN_SAMPLES, tinysynth_interface::settings::MAX_ROUTE,
            tinysynth_interface::settings::MIN_DRUM_SLOT,
            tinysynth_interface::settings::MAX_DRUM_SLOT,
            tinysynth_interface::settings::MAX_PROGRAM_SLOT,
            tinysynth_interface::settings::MIN_VOICES,
        ],
    );
}

#[test]
#[feature("safe_dispatcher")]
fn root_dispatchers_call_the_class() {
    let class_hash = class().class_hash;
    let synth: ITinySynthLibraryDispatcher =
        tinysynth_interface::interface::ITinySynthLibraryDispatcher {
        class_hash,
    };
    assert_eq!(synth.engine(), 'tinysynth');
    let safe = ITinySynthSafeLibraryDispatcher { class_hash };
    assert_eq!(safe.version().unwrap(), synth.version());

    // The remaining dispatchers and traits only need to resolve at the root.
    let address: starknet::ContractAddress = 0x1.try_into().unwrap();
    let _: tinysynth_interface::interface::ITinySynthDispatcher = ITinySynthDispatcher {
        contract_address: address,
    };
    let _ = ITinySynthSafeDispatcher { contract_address: address };
    let _: tinysynth_interface::interface::ISoundProviderDispatcher = ISoundProviderDispatcher {
        contract_address: address,
    };
    let _ = ISoundProviderSafeDispatcher { contract_address: address };
    let _ = ISoundProviderLibraryDispatcher { class_hash };
    let _ = ISoundProviderSafeLibraryDispatcher { class_hash };
}

/// The interface and dispatcher traits resolve at the root as bounds.
fn _root_traits<
    T,
    D,
    +ITinySynth<T>,
    +ISoundProvider<T>,
    +ISoundProviderDispatcherTrait<D>,
    +ISoundProviderSafeDispatcherTrait<D>,
>() {}
