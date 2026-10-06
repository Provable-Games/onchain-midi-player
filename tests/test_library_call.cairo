use onchain_midi_player::interface::ITinySynthDispatcherTrait;
use onchain_midi_player::segment_data;
use crate::helpers::class;
#[test]
fn exact_abi_fixed_segments_and_identity() {
    let synth = class();
    assert_eq!(synth.gunzip_segment(), segment_data::gunzip_segment());
    assert_eq!(synth.engine_segment(), segment_data::engine_segment());
    assert_eq!(synth.player_segment(), segment_data::player_segment());
    assert_eq!(synth.engine(), 'tinysynth');
    assert_eq!(synth.version(), '0.5.0');
    assert_eq!(synth.script_sha256(), segment_data::ENGINE_SHA256);
    assert_eq!(synth.license(), segment_data::license());
}
